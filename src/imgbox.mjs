// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

import path from 'node:path';
import { readOptions } from './webserver.mjs';
import { fatal, makeDir } from './misc.mjs';
import { createServer } from './server.mjs';
import { openDatabase } from './database.mjs';

const commands = [ 'start', 'initdb', 'importdb' ];

const helpmsg = `

usage: node src/imgbox.mjs imgbox.conf <command>

commands: start                  start the webserver (default if no command)
          initdb                 initialize the database
          importdb old.sqlite3   import (upgrading if necessary) old.sqlite3
`;

if (process.argv.length < 3) {
	fatal('invalid arguments' + helpmsg);
}

const command = (process.argv.length > 3) ? process.argv[3] : 'start';

if (!commands.includes(command)) {
	fatal(`error: unknown command '${process.argv[3]}'`);
}
const cfn = process.argv[2];

const options = readOptions(cfn, {
	defaultPerms:"i", storageDir:"s", mediaDir:"s", staticDir:"s",
});
if (!options) {
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
for (let a of "0123456789abcdef") {
	for (let b of "0123456789abcdef") {
		makeDir(path.join(options.mediaDir, a + b));
	}
}

if (!options.hasOwnProperty("defaultPerms")) {
	options.defaultPerms = 1;
}

console.log(options);

const dbpath = path.join(options.storageDir, "database.sqlite3");

if (command === "initdb") {
	const ok = openDatabase(dbpath, "<<init>>");
	process.exit(ok ? 0 : 1);
}
if (command === "importdb") {
	if (process.argv.length != 5) {
		fatal("error: importdb path required");
	}
	const ok = openDatabase(dbpath, process.argv[4]);
	process.exit(0 ? 0 : 1);
}

const db = openDatabase(dbpath);
process.on('SIGINT', () => {
	console.error("\n*** SIGINT ***\n\n");
	db.shutdown();
	process.exit(0);
});

const server = createServer(db, options);

server.start();

