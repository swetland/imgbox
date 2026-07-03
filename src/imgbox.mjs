// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

import path from 'node:path';
import { fatal, makeDir, readOptionsFile, randomBytes } from './misc.mjs';
import { createServer } from './server.mjs';
import { openDatabase } from './database.mjs';

if (process.argv.length != 3) {
	fatal('usage: node imgbox.mjs imgbox.conf');
}
const cfn = process.argv[2];

const keys = {
	host:"s", port:"i", storageDir:"s", staticDir:"s", maxUploadSizeMB:"i"
};

let options;
try {
	options = readOptionsFile(cfn, keys);
} catch (err) {
	fatal(`cannot read options file '${cfn}'`);
}

// ensure various directories are specified and exist
if (!options.storageDir) {
	fatal("storage option unspecified");
}
if (!options.staticDir) {
	options.staticDir = path.join(options.storageDir, "static");
}
if (!options.uploadDir) {
	options.uploadDir = path.join(options.storageDir, "upload");
}
if (!options.mediaDir) {
	options.mediaDir = path.join(options.storageDir, "media");
}
makeDir(options.storageDir);
makeDir(options.uploadDir);
makeDir(options.mediaDir);
makeDir(options.staticDir);

for (let a of "0123456789abcdef") {
	for (let b of "0123456789abcdef") {
		makeDir(path.join(options.mediaDir, a + b));
	}
}

console.log(options);

const db = openDatabase(path.join(options.storageDir, "database.sqlite3"));

const server = createServer(db, options);

server.start();

