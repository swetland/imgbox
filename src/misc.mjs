// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import util from 'node:util';
import { spawn as _spawn } from "node:child_process";

export const randomBytes = util.promisify(crypto.randomBytes);

// tag: must be one or more valid characters
const re_tag_valid_chars = /^[a-zA-Z0-9()_\-]+$/;

// tag: must not be: empty, leading/trailing underscore,
// double underscore
const re_tag_bad_ptns = /^$|^_|_$|__/;

export function isValidTag(tag) {
	if (typeof tag !== "string") {
		return false;
	}
	return re_tag_valid_chars.test(tag) &&
		!re_tag_bad_ptns.test(tag);
}

export function makeDir(dirpath) {
	let st;
	try {
		st = fs.statSync(dirpath);
	} catch {};
	if (st && !st.isDirectory()) {
		fatal(`not a directory: '${dirpath}'`);
	}
	try {
		fs.mkdirSync(dirpath, 0o755);
	} catch (err) {
		if (err.code === 'EEXIST') return;
		fatal(`cannot create directory '${dirpath}'`);
	}
}

export function readOptionsFile(fname, keys) {
	const options = {};
	const text = fs.readFileSync(fname, 'utf8');
	let lines = text.split('\n');
	for (let x of text.split('\n')) {
		x = x.trim();
		if (x[0] == '#') continue;
		x = x.split(':');
		if (x.length != 2) continue;
		let key = x[0].trim();
		let val = x[1].trim();
		const type = keys[key];
		if (type === "s") {
			options[key] = val;
		} else if (type === "i") {
			options[key] = parseInt(val);
		} else {
			console.log(`warning: unknown config option '${key}'`);
		}
	}
	return options;
}

export function fatal(msg) {
	console.error("error: " + msg);
	process.exit(1);
}

export async function spawn(cmd, args, opts) {
	let p = _spawn(cmd, args, opts);
	let r = { stdout: '', stderr: '', code: null };
	return new Promise((resolve) => {
		p.stdout.on('data', (data) => { r.stdout += data.toString(); });
		p.stderr.on('data', (data) => { r.stderr += data.toString(); });
		p.on('exit', (code) => {
			r.code = code;
			resolve(r);
		});
	});
}

export const flags = {
	IMAGE: 1,
	VIDEO: 2,
	AUDIO: 4,
};

export const perms = {
	QUERY: 1,
	UPLOAD: 2,
	EDIT: 4,
};
