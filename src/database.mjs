// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

import { DatabaseSync } from 'node:sqlite';
import { fatal, isValidTag } from './misc.mjs';

const ERR_CONSTRAINT_FOREIGNKEY = 787;
const ERR_CONSTRAINT_UNIQUE = 2067;
const ERR_CONSTRAINT_NOTNULL = 1299;

// flags
// 1 image
// 2 video
// 4 audio

const script_config_db = `
pragma foreign_keys = ON;
pragma temp_storage = MEMORY;
pragma journal_mode = WAL;
pragma synchronous = NORMAL;
pragma cache_size = -32768;
`

const script_init_v1 = `
create table if not exists imgbox_db_ver (
	version integer
) strict;

create table if not exists users (
	user_id integer primary key not null unique,
	name text not null unique,
	password text not null,
	perms integer not null default 0
) strict;

create table if not exists posts (
	post_id integer primary key not null unique,
	created_at integer default 0 not null,
	updated_at integer default 0 not null,
	source text default '' not null,
	caption text default '' not null,
	transcript text default '' not null,
	md5 text not null unique,
	sha1 text not null unique,
	format text not null,
	bytes integer not null,
	filename text,
	width integer not null,
	height integer not null,
	duration integer default 0 not null, -- milliseconds
	flags integer default 0 not null,
	parent_id integer,
	tags_count integer default 0 not null,
	tags_string text default '',
	foreign key (parent_id)
		references posts (post_id)
		on update set null
		on delete set null
) strict;
create index if not exists
	idx_posts_md5 on posts(md5);

create table if not exists tags (
	tag_id integer primary key not null unique,
	name text not null unique,
	posts_count integer default 0 not null,
	category integer default 0 not null
) strict;
create index if not exists
	idx_tags_name on tags(name);

create table if not exists posts_tags (
	post_id integer not null,
	tag_id integer not null,
	unique (post_id, tag_id),
	foreign key (post_id)
		references posts (post_id)
		on update restrict
		on delete cascade,
	foreign key (tag_id)
		references tags (tag_id)
		on update restrict
		on delete restrict
) strict;
create index if not exists
   idx_posts_tags_pid on posts_tags(post_id);
create index if not exists
   idx_posts_tags_tid on posts_tags(tag_id);

create table if not exists collections (
	collection_id integer primary key unique,
	name text not null unique
) strict;
create index if not exists
	idx_collections_name on collections(name);

create table if not exists posts_collections (
	collection_id integer not null,
	post_id integer not null,
	unique (collection_id, post_id),
	foreign key (collection_id)
		references collections (collection_id)
		on update restrict
		on delete restrict,
	foreign key (post_id)
		references posts (post_id)
		on update restrict
		on delete restrict
) strict;
create index if not exists
	idx_posts_collections_cid on posts_collections(collection_id);
create index if not exists
	idx_posts_collections_pid on posts_collections(post_id);

-- update summary data in posts and tags tables
-- when tag/post associations are added or removed
-- in the post_tags table
--
create trigger if not exists trg_posts_tags_ins
   after insert on posts_tags begin
      update posts set
         tags_count = tags_count + 1,
         tags_string = (select group_concat(name, ' ' order by name)
            from posts_tags inner join tags using (tag_id)
            where post_id = new.post_id)
         where post_id = new.post_id;
      update tags set
         posts_count = posts_count + 1 where tag_id = new.tag_id;
   end;

create trigger if not exists trg_posts_tags_del
   after delete on posts_tags begin
      update posts set
         tags_count = tags_count - 1,
         tags_string = (select group_concat(name, ' ' order by name)
            from posts_tags inner join tags using (tag_id)
            where post_id = old.post_id)
         where post_id = old.post_id;
      update tags set
         posts_count = posts_count - 1 where tag_id = old.tag_id;
   end;
`;

const script_import_v0 = `
insert into users (user_id, name, password, perms)
select user_id, name, password, perms from xdbx.users;

-- posts.tags_count, posts.tags_string will be recreated later
--
insert into posts (post_id, created_at, updated_at, source, md5, sha1, format, bytes, filename, width, height, duration, flags, parent_id)
select post_id, created_at, updated_at, source, md5, sha1, format, bytes, filename, width, height, duration, flags, parent_id from xdbx.posts;

-- tags.posts_count will be recreated later
--
insert into tags (tag_id, name, category)
select tag_id, name, category from xdbx.tags;

-- triggers will update tags.posts_count
-- posts.tags_count and posts.tags_string
--
insert into posts_tags (post_id, tag_id)
select post_id, tag_id from xdbx.posts_tags;

insert into collections (collection_id, name)
select collection_id, name from xdbx.collections;

insert into posts_collections (collection_id, post_id)
select collection_id, post_id from xdbx.posts_collections;
`;

export function openDatabase(path, opt) {
	const db = new DatabaseSync(path, {
		enableForeignKeyConstraints: true,
		enableDoubleQuotedStringLiterals: false,
		readBigInts: false,
		allowBareNamedParameters: false,
		allowUnknownNamedParameters: false,
	});

	db.exec(script_config_db);

	const psBegin = db.prepare('begin transaction;');
	const psCommit = db.prepare('commit;');
	const psRollback = db.prepare('rollback;');

	function isEmpty() {
		const r = db.prepare('select * from sqlite_schema;').all();
		return r.length ? false : true;
	}

	if (opt === "<<init>>") {
		console.error(`database: initializing '${path}'`);
		if (!isEmpty()) {
			console.error(`database: error: non-empty database '${path}'`);
			shutdown();
			return false;
		}
		db.exec(script_init_v1);
		db.exec('insert into imgbox_db_ver (version) values (1);');
		return shutdown();
	}

	if (typeof opt === "string") {
		console.error(`database: importing '${opt}'`);
		if (!checkEmpty()) {
			console.error(`database: error: non-empty database '${path}'`);
			shutdown();
			return false;
		}
		try {
			db.prepare('attach ? as xdbx;').run(opt);
			db.exec('begin transaction;');
			db.exec(script_init_v1);
			db.exec('insert into imgbox_db_ver (version) values (1);');
			db.exec(script_import_v0);
			db.exec('commit;');
		} catch (err) {
			console.error(`database: error: import failed: ${err}`);
			try {
				db.exec('rollback;');
			} catch (err) {
				console.error(`database: error: ${err}`);
			}
			shutdown();
			return false;
		}
		return shutdown();
	}

	if (isEmpty()) {
		fatal(`database: not initialized. use 'initdb' or 'importdb'`);
	}

	function getSchemaVersion() {
		try {
			const r = db.prepare('select * from imgbox_db_ver;').all();
			return r[0].version;
		} catch (err) {
			return 0;
		}
	}

	const v = getSchemaVersion();
	if (v != 1) {
		fatal(`database: unsupported db version ${v}`);
	}

	function error(err, where) {
		if (err.code !== 'ERR_SQLITE_ERROR') {
			console.log(`database: ${where}: error: ${err}`);
		} else {
			console.log(`database: ${where}: error: ${err}`);
		}
	}

	const psGetUserByName = db.prepare(
		'select * from users where name = ?');
	function getUserByName(name) {
		try {
			return psGetUserByName.get(name);
		} catch (err) {
			error(err, "getUserByName");
		}
	}

	const psGetPostTags = db.prepare(
		'select name, category from posts_tags ' +
		'inner join tags using (tag_id) ' +
		'where post_id = ? order by name',
		{ returnArrays: true });

	const psGetPostByMD5 = db.prepare(
		'select * from posts where md5 = ?');
	function getPostByMD5(md5) {
		try {
			return psGetPostByMD5.get(md5);
		} catch (err) {
			error(err, "getPostByMD5");
			return null;
		}
	}

	const psGetPostBySHA1 = db.prepare(
		'select * from posts where sha1 = ?');
	function getPostBySHA1(sha1) {
		try {
			return psGetPostBySHA1.get(sha1);
		} catch (err) {
			error(err, "getPostBySHA1");
			return null;
		}
	}

	const psGetPostById = db.prepare(
		'select * from posts where post_id = ?');
	function getPostById(id) {
		try {
			return psGetPostById.get(id);
		} catch (err) {
			error(err, "getPostById");
			return null;
		}
	}

	const psGetTags = db.prepare(
		'select name as tag, category as kind, posts_count as count from tags order by name');
	function getTags() {
		try {
			return psGetTags.all();
		} catch (err) {
			error(err, "getTags");
			return null;
		}
	}
	const psGetTagByName = db.prepare(
		'select * from tags where name = ?');
	function getTagByName(name) {
		try {
			if (!isValidTag(name)) {
				return null;
			}
			return psGetTagByName.get(name);
		} catch (err) {
			error(err, "getTagByName");
			return null;
		}
	}

	const psAddNewTag = db.prepare(
		'insert into tags (name) values(?)');
	function _addNewTag(tag_name) {
		try {
			psAddNewTag.run(tag_name);
			return true;
		} catch (err) {
			if (err.errcode == ERR_CONSTRAINT_UNIQUE) {
				return true;
			}
			error(err, "addNewTag");
			return false;
		}
	}

	const psAddTagToPostByName = db.prepare(
		'insert into posts_tags (post_id, tag_id) ' +
		'values (?, (select tag_id from tags where name = ?))');
	function _addTagToPostByName(post_id, tag_name) {
		try {
			psAddTagToPostByName.run(post_id, tag_name);
			return true;
		} catch (err) {
			if (err.errcode == ERR_CONSTRAINT_UNIQUE) {
				// tag/post pair already exists
				return true;
			}
			if (err.errcode == ERR_CONSTRAINT_FOREIGNKEY) {
				// invalid post_id
				return false;
			}
			if (err.errcode == ERR_CONSTRAINT_NOTNULL) {
				// post_id null or tag_name doesn't exist
				return false;
			}
			error(err, "addTagToPostByName");
			return false;
		}
	}

	function addTagToPostByName(post_id, tag_name) {
		if (!isValidTag(tag_name)) {
			return false;
		}
		if (_addTagToPostByName(post_id, tag_name)) {
			return true;
		}
		if (_addNewTag(tag_name)) {
			return _addTagToPostByName(post_id, tag_name);
		}
		return false;
	}

	const psRemoveTagFromPostByName = db.prepare(
		'delete from posts_tags where post_id = ? and ' +
		'tag_id = (select tag_id from tags where name = ?)');
	function removeTagFromPostByName(post_id, tag_name) {
		try {
			psRemoveTagFromPostByName.run(post_id, tag_name);
			return true;
		} catch (err) {
			error(err, "removeTagFromPostByName");
			return false;
		}
	}

	const psAddPost = db.prepare(
		'insert into posts (created_at, updated_at, md5, sha1, ' +
		'format, bytes, filename, width, height, flags, duration) ' +
		'values (unixepoch(), unixepoch(), $md5, $sha1, ' +
		'$format, $bytes, $filename, $width, $height, $flags, $duration)');
	function addPost(info) {
		try {
			const r = psAddPost.run({
				$md5: info.md5,
				$sha1: info.sha1,
				$format: info.format,
				$filename: info.filename,
				$bytes: info.bytes,
				$width: info.width,
				$height: info.height,
				$flags: info.flags,
				$duration: info.duration,
				});
			if (r.changes == 1) {
				return r.lastInsertRowid;
			}
		} catch (err) {
			console.log("DATABASE GO BOOM");
			console.log(err);
		}
		return null;
	}

	const psGetRecentPosts = db.prepare(
		'select * from posts order by post_id desc limit ?');
	const psGetMoreRecentPosts = db.prepare(
		'select * from posts where post_id < ? order by post_id desc limit ?');
	function getRecentPosts(limit, after) {
		if (after) {
			return psGetMoreRecentPosts.all(after, limit);
		} else {
			return psGetRecentPosts.all(limit);
		}
	}

	const re_query_valid = /^[a-zA-Z0-9]+$/;
	const psFindPosts = db.prepare(
		'select * from posts where filename like ? order by post_id desc');
	const psFindNoTags = db.prepare(
		'select * from posts where tags_count = 0 order by post_id desc');
	const psFindPostsByTag = db.prepare(
		'with list as (select post_id, tag_id, count(*) from posts_tags where tag_id in (?) group by post_id having count(*) = 1) select posts.* from posts, list where posts.post_id = list.post_id order by post_id desc;');
	const psFindPostsByTag2 = db.prepare(
		'with list as (select post_id, tag_id, count(*) from posts_tags where tag_id in (?,?) group by post_id having count(*) = 2) select posts.* from posts, list where posts.post_id = list.post_id order by post_id desc;');
	const psFindPostsByTag3 = db.prepare(
		'with list as (select post_id, tag_id, count(*) from posts_tags where tag_id in (?,?,?) group by post_id having count(*) = 3) select posts.* from posts, list where posts.post_id = list.post_id order by post_id desc;');
	function findPosts(q) {
		try {
			if (q.length == 0) {
				return psGetRecentPosts.all(1000);
			}
			if (q === "notags") {
				return psFindNoTags.all();
			}
			if (q.startsWith("/")) {
				q = q.substring(1);
				if (!re_query_valid.test(q)) {
					return null;
				}
				return psFindPosts.all(`%${q}%`);
			}
			const tags = q.split(" ");
			const ids = [];
			for (let t of tags) {
				const tag = getTagByName(t);
				if (!tag.tag_id) return false;
				ids.push(tag.tag_id);
			}
			if (ids.length == 1) {
				return psFindPostsByTag.all(ids[0]);
			}
			if (ids.length == 2) {
				return psFindPostsByTag2.all(...ids);
			}
			if (ids.length == 3) {
				return psFindPostsByTag3.all(...ids);
			}
			return false;
		} catch (err) {
			error(err, "findPosts");
			return null;
		}
	}

	function backup(filename) {
		const s = db.prepare("vacuum into ?;");
		try {
			s.run(filename);
			return true;
		} catch (err) {
			console.error(err);
			return false;
		}
	}

	function shutdown() {
		try {
			db.exec("pragma wal_checkpoint(TRUNCATE);");
			db.close();
			return true;
		} catch (err) {
			console.error(err);
			return false;
		}
	}
	return {
		addPost,
		getPostById, getPostBySHA1, getPostByMD5,
		getRecentPosts,
		findPosts,
		getTags,
		getTagByName,
		addTagToPostByName,
		removeTagFromPostByName,
		getUserByName,
		backup, shutdown,
		// debugging use:
		db,
	};
}

