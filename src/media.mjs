// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

import path from 'node:path';
import { spawn, flags } from './misc.mjs';

const image_formats = {
	"jpeg": "jpg",
	"gif": "gif",
	"png": "png",
	"avif": "avif",
	"webp": "webp",
};
const video_formats = {
	"mpeg-4": "mp4",
	"webm": "webm",
};

async function identify(srcpath) {
	let r = await spawn("mediainfo", [ "--Output=JSON", srcpath ]);
	if (r.code != 0) {
		return { error: "mediainfo exec failure" };
	}
	let res;
	try {
		res = JSON.parse(r.stdout);
	} catch (err) {
		console("JSON ERROR");
		console(r.stdout);
		return { error: "mediainfo json failure" };
	}
	try {
		let general, video, image, audio;
		for (let track of res.media.track) {
			const type = track["@type"];
			if ((type === "General") && !general) {
				general = track;
			} else if ((type === "Image") && !image) {
				image = track;
			} else if ((type === "Video") && !video) {
				video = track;
			} else if ((type === "Audio") && !audio) {
				audio = track;
			}
		}
		let format = general.Format.toLowerCase();
		let info = { flags: 0 };
		if (Object.hasOwn(image_formats, format)) {
			info.flags |= flags.IMAGE;
			info.format = image_formats[format];
			if ((format == 'webp') && !image) {
				info.width = video.Width;
				info.height = video.Height;
				info.duration = Math.floor(video.Duration * 1000.0);
				info.codec = video.Format;
			} else {
				info.width = image.Width;
				info.height = image.Height;
				info.duration = 0;
			}
		} else if (Object.hasOwn(video_formats, format)) {
			info.flags |= flags.VIDEO;
			info.format = video_formats[format];
			info.width = video.Width;
			info.height = video.Height;
			info.duration = Math.floor(video.Duration * 1000.0);
			info.codec = video.Format;
			if (audio) {
				info.flags |= flags.AUDIO;
			}
		} else {
			return { error: "unidentified content", err: null }
		}
		return info;
	} catch (err) {
		console.log(err);
		return { error: "parse error", err };
	}
}

// TODO: timeouts
// TODO: limit number of concurrently spawned processes
// TODO: ffmpeg seems to report success very generously
// (for example if it can't open the output file, exit code is still 0)

async function frame(srcpath, dstpath, when) {
	const r = await spawn("ffmpeg",
		[ "-n", "-i", srcpath, "-ss", when, "-q:v", "3", "-update", "1", "-vframes", "1", dstpath ]);
	if (r.code == 0) {
		return true;
	} else {
		return false;
	}
}

async function thumbnail(srcpath, dstpath, maxsize) {
	const r = await spawn("convert",
		[ "-resize", `${maxsize}x${maxsize}>`, `${srcpath}[0]`, dstpath ]);
	if (r.code == 0) {
		return true;
	} else {
		console.log(`CODE ${r.code}`);
		return false;
	}
}

export default {
	identify,
	frame,
	thumbnail
};
