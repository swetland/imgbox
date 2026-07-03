// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

import { createWebServer } from './webserver.mjs';
import { flags } from './misc.mjs';
import media from './media.mjs';

import path from 'node:path';
import fs from 'node:fs';

export function createServer(_db, _options) {
	const db = _db;
	const options = _options;
	const webserver = createWebServer(options);
	const thumbnail_sizes = [ 384, 768 ];

	function mediaDir(sha1) {
		// ${storageDir}/media/##/...
		return path.join(options.storageDir, 'media', sha1.substring(0, 2));
	}

	function mediaUrl(sha1) {
		// /media/##/...
		return `/media/${sha1.substring(0, 2)}/`
	}

	// post_id: tag_name:
	function doApiAddTagToPost(msg) {
		if (!db.addTagToPostByName(msg.post_id, msg.tag_name)) {
			return { error: "database" };
		} else {
			return {};
		}
	}

	// post_id: tag_name:
	function doApiRemoveTagFromPost(msg) {
		if (!db.removeTagFromPostByName(msg.post_id, msg.tag_name)) {
			return { error: "database" };
		} else {
			return {};
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
	function doApiGetPost(msg) {
		const post = db.getPostById(msg.post_id);
		if (post) {
			preparePost(post);
			return { post: post };
		} else {
			return { error: "does not exist" };
		}
	}

	function doApiGetRecentPosts(msg) {
		let posts = db.getRecentPosts(50, parseInt(msg.after, 10));
		for (let p of posts) {
			preparePost(p);
		}
		return { posts: posts };
	}

	function doApiFindPosts(msg) {
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

	function doApiGetTags(msg) {
		let tags = db.getTags();
		if (tags) {
			return { tags: tags };
		} else {
			return { tags: [] };
		}
	}

	const endpoints = {
		"getPost": doApiGetPost,
		"getRecentPosts": doApiGetRecentPosts,
		"findPosts": doApiFindPosts,
		"addTagToPost": doApiAddTagToPost,
		"removeTagFromPost": doApiRemoveTagFromPost,
		"getTags": doApiGetTags,
	}
	function doAPI(msg, relpath) {
		const fn = endpoints[relpath];
		if (fn) {
			return fn(msg);
		}
		return { error: "invalid endpoint" };
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
	async function doUpload(info, relpath) {
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
	webserver.addUploadEndpoint("/upload/", doUpload);
	webserver.addStatic("/media/", options.mediaDir);
	webserver.addStatic("/", options.staticDir);

	return { start };
}

export default { createServer };

