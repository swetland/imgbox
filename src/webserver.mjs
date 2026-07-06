// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as misc from './misc.mjs';

const default_mimetypes = {
	html: "text/html; charset=UTF-8",
	json: "application/json; charset=UTF-8",
	txt: "text/plain; charset=UTF-8",
	css: "text/css",
	png: "image/png",
	jpg: "image/jpg",
	gif: "image/gif",
	ico: "image/x-icon",
	svg: "image/svg+xml",
	mjs: "application/javascript",
	js: "application/javascript",
};


export function createWebServer(options, _getSession) {
	const host = options.host || "localhost";
	const port = options.port || 8000;
	const baseurl = `http://${host}:${port}`;
	const server = http.createServer(handler);
	const handlers = [];
	const mimeTypes = default_mimetypes;
	const maxApiMsgSize = options.maxApiMsgSize || 1024*1024;
	const maxUploadSizeMB = options.maxUploadSizeMB || 8;
	const uploadDir = options.uploadDir || "/tmp";
	const maxUploadSize = maxUploadSizeMB * 1024 * 1024;
	const getSession = _getSession ? _getSession : () => { return {}; };

	function getCookie(req, name) {
		let c = req.headers['cookie'];
		if (!c) return null;
		for (let x of c.split(";")) {
			x = x.trim();
			if (x.startsWith(name)) {
				return x.substring(name.length);
			}
		}
	}

	function handler(req, res) {
		req.session = getSession(getCookie(req, "session="));
		try {
			const u = new URL(req.url, baseurl);
			const path = u.pathname;
			console.log("request: " + path);
			for (const ctx of handlers) {
				if (path.startsWith(ctx.urlpath)) {
					const relpath = path.substring(ctx.urlpath.length);
					return ctx.fn(req, res, ctx, relpath);
				}
			};
			handleError(res, 500, "request: error: no handler");
		} catch (err) {
			// terminate connection
			req.destroy();
			console.log(`request: error: ${err.stack}`);
		}
	}
	function handleError(res, eno, why) {
		console.log(`error: http: ${eno}: ${why}`);
		res.writeHead(eno, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: why }));
	}
	async function handleStatic(req, res, ctx, relpath) {
		if (req.method !== 'GET') {
			res.setHeader("Allow", "GET");
			return handleError(res, 405, "method not allowed");
		}
		//console.log("static: RELPATH: " + relpath);

		const paths = [ctx.fspath, relpath];
		if ((relpath === "") || relpath.endsWith("/")) {
			paths.push("index.html")
		}
		const fspath = path.join(...paths);
		//console.log(`static: FSPATH: ${fspath}`);

		// ensure we're within the static file area
		if (!fspath.startsWith(ctx.fspath)) {
			console.log(`static: invalid path`);
			return handleError(res, 404, "not found");
		}

		const ext = path.extname(fspath).substring(1).toLowerCase();
		const mimetype = mimeTypes[ext] || "application/octet-stream";
		res.setHeader('Content-Type', mimetype);

		let fh;
		let sz = 0;
		try {
			fh = await fs.promises.open(fspath);
			const st = await fh.stat();
			if (st.isDirectory()) {
				fh.close();
				//console.log(`static: error: path '${fspath}' is directory`);
				res.writeHead(302, { 'Location': `${relpath}/index.html` });
				res.end();
				return;
			}
			if (!st.isFile()) {
				return handleError(res, 404, "not found");
			}
			sz = st.size;
		} catch (err) {
			//console.log(`static: error: path '${fspath}' failed to open: ${err}`);
			return handleError(res, 404, "not found");
		}

		try {
			const rs = fh.createReadStream();
			// TODO: handle short read?
			res.writeHead(200, {
				'Content-Type': mimetype,
				'Content-Length': sz.toString() });
			await pipeline(rs, res);
		} catch (err) {
			console.log(`static: error: send: ${err}`);
			req.destroy();
		}
	}
	async function handleEndpoint(req, res, ctx, relpath) {
		if (req.method !== 'POST') {
			res.setHeader("Allow", "POST");
			return handleError(res, 405, "method not allowed");
		}
		// TODO: validate:
		//const contentType = req.headers['content-type'] || '';

		let body = [];
		let size = 0;
		req.on('error', err => {
			console.log(`endpoint: error: ${err}`);
			handleError(res, 500, "unknown");
		});
		req.on('data', chunk => {
			size += chunk.length;
			if (size > maxApiMsgSize) {
				handleError(res, 413, "payload too large");
				req.destroy();
			} else {
				body.push(chunk);
			}
		});
		req.on('end', async () => {
			let msg;
			try {
				msg = JSON.parse(Buffer.concat(body).toString());
				if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
					return handleError(res, 400, "invalid json object");
				}
			} catch (err) {
				return handleError(res, 400, "invalid json object");
			}
			let text;
			try {
				let r = await ctx.apifn(req, res, msg, relpath);
				text = JSON.stringify(r);
			} catch (err) {
				console.log(`endpoint: error: ${err.stack}`);
				return handleError(res, 500, "internal error");
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
  			res.end(text);
		});
	}

	function handleUploadError(req, res, path, err, msg) {
		fs.unlink(path, () => {});
		// ensure we don't blow up the HTTP stack by
		// reporting a second error
		if (!res.finished) {
			handleError(res, err, msg);
			req.destroy();
		}
	}

	async function handleUploadEndpoint(req, res, ctx, relpath) {
		if (req.method !== 'POST') {
			res.setHeader("Allow", "POST");
			return handleError(res, 405, "method not allowed");
		}

		let contentLength = req.headers['content-length'];
		if (contentLength && (contentLength > maxUploadSize)) {
			return handleError(res, 413, "payload too large");
		}
		try {
			let r = await ctx.chkfn(req, res, relpath);
			if (!r) {
				return handleError(res, 400, "permission");
			}
		} catch (err) {
			console.log(`upload: chkfn: ${err.stack}`);
			return handleError(res, 500, "internal error");
		}
		let size = 0;
		const md5 = createHash('md5');
		const sha1 = createHash('sha1');
		const name = (await misc.randomBytes(16)).toString('hex');
		let path = `${uploadDir}/${name}`;

		const ws = fs.createWriteStream(path);

		req.on('error', (err) => {
			console.log(`upload: error: ${err}`);
			handleUploadError(req, res, path, 500, "io");
		});
		req.on('data', (chunk) => {
			size += chunk.length;
			md5.update(chunk);
			sha1.update(chunk);
			if (size > maxUploadSize) {
				handleUploadError(req, res, path,
					413, "payload too large");
			}
		});
		try {
			await pipeline(req, ws);
		} catch (err) {
			console.log(`upload: pipeline: ${err.stack}`);
			handleUploadError(req, res, path, 500, "io");
			return;
		}

		if (res.finished) {
			// we errored out elsewhere
			return;
		}
		let text;
		try {
			let r = await ctx.apifn(req, res, {
				md5: md5.digest('hex'),
				sha1: sha1.digest('hex'),
				path: path,
				size: size },
				relpath);
			text = JSON.stringify(r);
		} catch (err) {
			console.log(`upload: apifn: ${err.stack}`);
			handleUploadError(req, res, path, 500, "internal error");
			return;
		}
		res.writeHead(200, { 'Content-Type': 'application/json' });
		console.log(`upload: response: ${text}`);
		res.end(text);
	}

	// public methods
	function addStatic(urlpath, fspath) {
		handlers.push({ urlpath, fspath, fn: handleStatic });
	}
	function addEndpoint(urlpath, apifn) {
		handlers.push({ urlpath, apifn, fn: handleEndpoint });
	}
	function addUploadEndpoint(urlpath, chkfn, apifn) {
		handlers.push({ urlpath, chkfn, apifn, fn: handleUploadEndpoint });
	}
	function start() {
		server.listen(port, host, () => {
			console.log(`SERVER: ${baseurl}`);
		});
	}
	return { start, addStatic, addEndpoint, addUploadEndpoint };
}

