// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

import { createWebServer } from './webserver.mjs';
import { flags, perms, randomBytes } from './misc.mjs';
import media from './media.mjs';

import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const re_is_hex_digits = /[0-9a-fA-F]+/;

export function createServer(_db, _options) {
	const db = _db;
	const options = _options;
	const thumbnail_sizes = [ 384, 768 ];
	const default_session = {
		username: "anonymous",
		perms: options.defaultPerms,
	};
	const sessions = new Map();

	async function makeSession(session) {
		while (true) {
			const sid = (await randomBytes(32)).toString('hex');
			if (sessions.get(sid)) continue;
			session.sid = sid;
			sessions.set(sid, session);
			return sid;
		}
	}

	function getSession(sid) {
		if ((typeof sid !== 'string') ||
			(sid.length != 64) ||
			(!re_is_hex_digits.test(sid))) {
			return default_session;
		}
		const session = sessions.get(sid);
		return session ? session : default_session;
	}

	const webserver = createWebServer(options, getSession);

	function mediaDir(sha1) {
		// ${storageDir}/media/##/...
		return path.join(options.storageDir, 'media', sha1.substring(0, 2));
	}

	function mediaUrl(sha1) {
		// /media/##/...
		return `media/${sha1.substring(0, 2)}/`
	}

	const err_database = { error: "database" };
	const err_perms = { error: "permissions" };
	const err_notfound = { error: "not found" };
	const okay = {};

	// post_id: tag_name:
	function doApiAddTagToPost(req, res, msg) {
		if (!(req.session.perms & perms.EDIT)) {
			return err_perms;
		}
		if (!db.addTagToPostByName(msg.post_id, msg.tag_name)) {
			return err_datbase;
		} else {
			return okay;
		}
	}

	// post_id: tag_name:
	function doApiRemoveTagFromPost(req, res, msg) {
		if (!(req.session.perms & perms.EDIT)) {
			return err_perms;
		}
		if (!db.removeTagFromPostByName(msg.post_id, msg.tag_name)) {
			return err_database;
		} else {
			return okay;
		}
	}

	function preparePost(p) {
		p.media_base = mediaUrl(p.sha1) + p.sha1;
		delete p.sha1;
		delete p.md5;
		p.media_s = [ '.384.jpg', 384, 384 ];
		p.media_m = [ '.768.jpg', 768, 768 ];
		p.media_o = [ '.orig.' + p.format, p.width, p.height ];
	}

	// post_id
	function doApiGetPost(req, res, msg) {
		if (!(req.session.perms & perms.QUERY)) {
			return err_perms;
		}
		const post = db.getPostById(msg.post_id);
		if (post) {
			preparePost(post);
			return { post: post };
		} else {
			return err_notfound;
		}
	}

	function doApiGetRecentPosts(req, res, msg) {
		if (!(req.session.perms & perms.QUERY)) {
			return err_perms;
		}
		let posts = db.getRecentPosts(50, parseInt(msg.after, 10));
		for (let p of posts) {
			preparePost(p);
		}
		return { posts: posts };
	}

	function doApiFindPosts(req, res, msg) {
		if (!(req.session.perms & perms.QUERY)) {
			return err_perms;
		}
		let posts = db.findPosts(msg.query);
		if (posts) {
			for (let p of posts) {
				preparePost(p);
			}
			return { posts: posts };
		} else {
			return { posts: [] };
		}
	}

	function doApiGetTags(req, res, msg) {
		if (!(req.session.perms & perms.QUERY)) {
			return err_perms;
		}
		let tags = db.getTags();
		if (tags) {
			return { tags: tags };
		} else {
			return { tags: [] };
		}
	}

	async function doLogin(req, res, msg) {
		if ((typeof msg.name !== 'string') ||
			(typeof msg.pass !== 'string')) {
			return { error: "bad parameters" };
		}
		const pass = createHash('sha1').update(msg.pass).digest('hex');
		const user = db.getUserByName(msg.name);
		if (!user || user.password !== pass) {
			return { error: "login failure" };
		}
		const sid = await makeSession({ username: user.name, perms: user.perms });
		res.setHeader("Set-Cookie",
			`session=${sid}; Path=/; Secure; HttpOnly; SameSite=Lax`);
		console.log(`SESSION ${sid}: user='${user.name}' perms=${user.perms}`);
		return {}
	}

	const endpoints = {
		"getPost": doApiGetPost,
		"getRecentPosts": doApiGetRecentPosts,
		"findPosts": doApiFindPosts,
		"addTagToPost": doApiAddTagToPost,
		"removeTagFromPost": doApiRemoveTagFromPost,
		"getTags": doApiGetTags,
		"login": doLogin,
	}
	async function doAPI(req, res, msg, relpath) {
		const fn = endpoints[relpath];
		if (fn) {
			return fn(req, res, msg);
		}
		return { error: "invalid endpoint" };
	}

	async function doCheckUpload(req, res, relpath) {
		if (req.session.perms & perms.UPLOAD) {
			return true;
		}
	}

	async function mkthumbs(base, mi) {
		try {
			let src = base;
			// if video, first obtain a frame capture
			if (mi.flags & flags.VIDEO) {
				const frame = `${base}.frame.jpg`;
				if (!await media.frame(src, frame, "00:00:00.500")) {
					return false;
				}
				src = frame;
			}
			if (!await media.thumbnail(src, `${base}.384.jpg`, 384)) {
				return false;
			}
			if (!await media.thumbnail(src, `${base}.768.jpg`, 768)) {
				return false;
			}
		} catch (err) {
			console.log(err);
			return false;
		}
		return true;
	}
	async function addPost(upath, mi, collection) {
		const xmd5 = db.getPostByMD5(mi.md5);
		if (xmd5) {
			return { error: "duplicate", post_id: xmd5.post_id };
		}
		const xsha1 = db.getPostBySHA1(mi.sha1);
		if (xsha1) {
			return { error: "duplicate", post_id: xsha1.post_id };
		}
		if (! await mkthumbs(upath, mi)) {
			return { error: "thumbnail generation failure" };
		}
		try {
			const spath = path.join(mediaDir(mi.sha1), mi.sha1);
			await fs.promises.rename(upath, `${spath}.orig.${mi.format}`);
			if (mi.flags & flags.VIDEO) {
				await fs.promises.rename(`${upath}.frame.jpg`, `${spath}.frame.jpg`);
			}
			await fs.promises.rename(`${upath}.384.jpg`, `${spath}.384.jpg`);
			await fs.promises.rename(`${upath}.768.jpg`, `${spath}.768.jpg`);
		} catch (err) {
			console.log(err);
			//TODO: remove any temporaries that might be sitting around
			return { error: "file io" };
		}
		const id = db.addPost(mi);
		if (!id) {
			return { error: "database failure" };
		} else {
			return { post_id: id };
		}
	}
	async function doUpload(req, res, info, relpath) {
		let filename;
		try {
			filename = decodeURIComponent(relpath);
		} catch (err) {
			filename = relpath;
		}
		let parts = filename.split('/');
		if (parts.length > 2) {
			return { error: "invalid upload parameters" };
		}
		let collection = null;
		if (parts.length == 2) {
			collection = parts[0];
			filename = parts[1];
		}

		//TODO: sanitize filename
		//console.log(`UPLOAD ${filename} (collection: ${collection}) ${JSON.stringify(info)}`);
		const mi = await media.identify(info.path);
		if (mi.error) {
			return mi;
		}
		mi.md5 = info.md5;
		mi.sha1 = info.sha1;
		mi.bytes = info.size;
		mi.filename = filename;

		//console.log(`NEW POST ${JSON.stringify(mi, null, 1)}`);
		return await addPost(info.path, mi, collection)
	}

	function start() {
		webserver.start();
	}

	webserver.addEndpoint("/api/", doAPI);
	webserver.addUploadEndpoint("/upload/", doCheckUpload, doUpload);
	webserver.addStatic("/media/", options.mediaDir);
	webserver.addStatic("/", options.staticDir);

	return { start };
}

export default { createServer };

