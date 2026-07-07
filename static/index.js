// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

"use strict";

const flags = {
	IMAGE: 1,
	VIDEO: 2,
	AUDIO: 3,
};

function ID(id) {
	return document.getElementById(id);
}

const ui = {
	tilegrid: ID("tilegrid"),
	viewer: ID("viewer"),
	sidebar: ID("sidebar"),
	infobox: ID("infobox"),
	infotags: ID("infotags"),
	quicktags: ID("quicktags"),
	quicktags_label: ID("quicktags-label"),
	search_text: ID("search-text"),
	search_comp: ID("search-comp"),
	addtag_text: ID("addtag-text"),
	addtag_label: ID("addtag-label"),
	addtag_comp: ID("addtag-comp"),
	viewer_vid: ID("viewer-vid"),
	viewer_img: ID("viewer-img"),
	alert_bar: ID("alert-bar"),
	upload: ID("upload"),
	upload_list: ID("upload-list"),
};

const menubar = [];

function menuClick(name) {
	for (let x of menubar) {
		if (x.name === name) {
			x.mode.style.display = "flex";
			x.menu.classList.add("active");
		} else {
			x.mode.style.display = "none";
			x.menu.classList.remove("active");
		}
	}
}

for (let x of [ "info", "upload", "help" ]) {
	const menu = ID("menu-" + x);
	const mode = ID("mode-" + x);
	menubar.push( { name: x, mode, menu } );
	if (name === "upload") {
		menu.addEventListener("click", (e) => {
			menuClick(x);
			ui.upload.click();
		});
	} else {
		menu.addEventListener("click", (e) => {
			menuClick(x);
		});
	}
}

async function uploadFileList(files) {
	ui.upload.value = null;
	const list = document.createElement("button-stack");
	const work = [];
	for (let f of files) {
		const b = document.createElement("button");
		b.innerText = f.name;
		list.appendChild(b);
		work.push({ name: f.name, file: f, button: b });
	}
	ui.upload_list.replaceChildren(list);
	ui.tilegrid.focus();
	uploadFiles(work);
}
ui.upload.addEventListener("cancel", (e) => {
	menuClick("info");
	ui.tilegrid.focus();
});
ui.upload.addEventListener("change", async (e) => {
	uploadFileList(ui.upload.files);
});
ui.sidebar.addEventListener("dragenter", (e) => { e.preventDefault(); });
ui.sidebar.addEventListener("dragover", (e) => { e.preventDefault(); });
ui.sidebar.addEventListener("drop", (e) => {
	e.preventDefault();
	const dt = e.dataTransfer;
	const files = dt.files;
	menuClick("upload");
	uploadFileList(files);
});

let alert_bar_timeout = null;

function notify(msg) {
	if (alert_bar_timeout) {
		clearTimeout(alert_bar_timeout);
	}
	ui.alert_bar.innerText = msg;
	ui.alert_bar.style.display = "block";
	alert_bar_timeout = setTimeout(() => {
		ui.alert_bar.style.display = "none"; }, 1500);
}

const posts_by_id = new Map();
let viewer_is_open = false;
let viewer_is_video = false;
let viewer_post = null;
let sidebar_post = null;

let tags_map = new Map();
let tags_list = [];
let tags_quick = [];

function importTags(tags) {
	for (let tag of tags) {
		if (!tags_map.get(tag.tag)) {
			tags_map.set(tag.tag, tag);
			tags_list.push(tag);
		}
	}
}
function importTag(name) {
	if (!tags_map.get(name)) {
		const tag = { tag: name, kind: 0, count: 1 };
		tags_map.set(name, tag);
		tags_list.push(tag);
	} else {
		tags_map.get(name).count++;
	}
}

function saveQuickTags() {
	window.localStorage.setItem(
		"net.frotz.imgbox.quicklist",
		JSON.stringify(tags_quick));
}
function addQuickTag(name) {
	name = name.trim();
	if (tags_quick.indexOf(name) < 0) {
		tags_quick.push(name);
		tags_quick = tags_quick.sort();
		saveQuickTags();
	}
}
function removeQuickTag(name) {
	name = name.trim();
	tags_quick = tags_quick.filter(t => t != name);
	saveQuickTags();
}

function newTileGrid(_elem) {
	const grid = _elem;
	const selected = new Map();
	let all = [];
	let cols = 5;
	let active = null;
	let _Click = () => {};
	let _DblClick = () => {};
	let _Selection = () => {};
	let _Activation = () => {};

	function onClick(fn) { _Click = fn; }
	function onDblClick(fn) { _DblClick = fn; }
	function onSelection(fn) { _Selection = fn; }
	function onActivation(fn) { _Activation = fn; }

	function countColumns() {
		cols = window.getComputedStyle(tilegrid)
			.getPropertyValue("grid-template-columns")
			.split(" ").length;
	};
	window.addEventListener("resize", countColumns);
	window.addEventListener("DOMContentLoaded", countColumns);
	grid.addEventListener("resize", countColumns);

	function setSize(sz) {
		document.documentElement.style.setProperty("--tile-size", sz);
		countColumns();
	}

	function push(tile, elem) {
		elem._idx = all.length;
		tile._idx = all.length;
		tile._elem = elem;
		all.push(tile);
		grid.appendChild(elem);
		elem.addEventListener("click", (e) => { _Click(e, tile); });
		elem.addEventListener("dblclick", (e) => { _DblClick(e, tile); });
	}

	function activate(tile, scroll) {
		if (!tile) return;
		if (active) {
			if (active == tile) return;
			active._elem.classList.remove("focused");
		}
		tile._elem.classList.add("focused");
		if (scroll) {
			tile._elem.scrollIntoView({ block: "center" });
		}
		active = tile;
		_Activation(tile);
	}

	function goNorth(scroll) {
		activate(active ? all[active._idx - cols] : all[0], scroll);
		return active;
	}
	function goSouth(scroll) {
		activate(active ? all[active._idx + cols] : all[0], scroll);
		return active;
	}
	function goEast(scroll) {
		if (!active) {
			activate(all[0], scroll);
		} else if ((active._idx + 1) % cols) {
			activate(all[active._idx + 1], scroll);
		}
		return active;
	}
	function goWest(scroll) {
		if (!active) {
			activate(all[0], scroll);
		} else if (active._idx % cols) {
			activate(all[active._idx - 1]);
		}
		return active;
	}

	function prev(tile) {
		return all[tile._idx - 1];
	}
	function next(tile) {
		return all[tile._idx + 1];
	}

	function select(tile) {
		if (!selected.get(tile)) {
			selected.set(tile, tile);
			tile._elem.classList.add("selected");
			_Selection(selected.size);
		}
	}
	function deselect(tile) {
		if (selected.delete(tile)) {
			tile._elem.classList.remove("selected");
			_Selection(selected.size);
		}
	}
	function toggle(tile) {
		if (selected.get(tile)) {
			tile._elem.classList.remove("selected");
			selected.delete(tile);
		} else {
			tile._elem.classList.add("selected");
			selected.set(tile, tile);
		}
		_Selection(selected.size);
	}
	function selectAll() {
		for (let tile of all) select(tile);
		_Selection(selected.size);
	}
	function deselectAll() {
		for (let tile of selected.values()) {
			tile._elem.classList.remove("selected");
		}
		selected.clear();
		_Selection(selected.size);
	}
	function getSelected() {
		if (selected.size) {
			return Array.from(selected.values());
		} else {
			return null;
		}
	}
	function clear() {
		selected.clear();
		all = [];
		active = null;
		grid.replaceChildren();
		_Selection(selected.size);
		_Activation(null);
	}
	function getActive() {
		return active;
	}
	return {
		push, clear, setSize, prev, next,
		activate, goNorth, goSouth, goEast, goWest, getActive,
		select, deselect, toggle, selectAll, deselectAll,
		getSelected,
		onClick, onDblClick, onSelection, onActivation,
	};
}

const grid = newTileGrid(ui.tilegrid);

grid.onSelection((n) => {
	if (n > 0) {
		if (n == 1) {
			ui.addtag_label.innerText = "Add Tag (to 1 selected post):";
		} else {
			ui.addtag_label.innerText = `Add Tag (to ${n} selected posts):`;
		}
		ui.addtag_text.classList.add("selected");
	} else {
		ui.addtag_label.innerText = "Add Tag:";
		ui.addtag_text.classList.remove("selected");
	}
});
grid.onClick((e, tile) => {
	if (e.ctrlKey) {
		grid.toggle(tile);
	} else {
		grid.activate(tile);
	}
});
grid.onDblClick((e, tile) => {
	openViewer(tile);
});
grid.onActivation(sidebarShowPostInfo);

function activePost() {
	if (viewer_is_open) return viewer_post;
	return grid.getActive();
}

// Sidebar Display
function formatBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1048576).toFixed(1)} MB`;
}

function formatDuration(n) {
	n = n / 1000.0; // ms to s
	if (n < 60) {
		return `${n.toFixed(2)} s`;
	}
	return `${Math.floor(n/60.0)} m ${Math.floor(n % 60.0)} s`;
}

function formatDurationTag(n) {
	n = n / 1000.0;
	let s = n % 60.0;
	let m = n / 60.0;
	if (n < 1)  return '0:01';
	if (s < 10) return `${Math.floor(m)}:0${Math.floor(s)}`;
	return `${Math.floor(m)}:${Math.floor(s)}`;
}

function addListItem(list, label, text) {
	const dt = document.createElement('dt');
	dt.innerText = label;
	const dd = document.createElement('dd');
	dd.innerText = text;
	list.append(dt, dd);
}

function sidebarShowTags(post) {
	const list = document.createElement("button-stack");
	for (let tag of post.tags) {
		let li = document.createElement("button");
		li.innerText = tag.replaceAll("_"," ");
		let count = document.createElement("span");
		count.innerText = tags_map.get(tag).count;
		li.appendChild(count);
		li.addEventListener("click", (e) => {
			if (e.ctrlKey) {
				removeTag(tag, post);
			} else if (e.shiftKey) {
				addQuickTag(tag);
				sidebarUpdateQuickTags();
			} else {
				doSearch(tag);
			}
			e.preventDefault();
		});
		list.appendChild(li);
	}
	ui.infotags.replaceChildren(list);
}

function sidebarShowPostInfo(post) {
	let list = document.createElement('dl');
	sidebar_post = post;
	if (post) {
		addListItem(list, "ID", post.post_id);
		addListItem(list, "Dimensions", `${post.width} x ${post.height}`);
		addListItem(list, "File Size", formatBytes(post.bytes));
		addListItem(list, "File Format", post.format);
		if (post.duration > 0) {
			addListItem(list, "Duration", formatDuration(post.duration));
		}
		sidebarShowTags(post);
	} else {
		ui.infotags.replaceChildren();
	}
	ui.infobox.replaceChildren(list);
}

function sidebarUpdateQuickTags() {
	const list = document.createElement("button-stack");
	let n = 1;
	for (let tag of tags_quick) {
		let li = document.createElement("button");
		let x = document.createElement("strong");
		let y = document.createElement("span");
		//x.innerText = " + ";
		y.innerText = tag.replaceAll("_", " ");
		li.replaceChildren(x, y);
		li.addEventListener("click", (e) => {
			if (e.ctrlKey) {
				removeQuickTag(tag);
				sidebarUpdateQuickTags();
			} else {
				applyTag(tag);
			}
			e.preventDefault();
		});
		if (n < 10) {
			li.classList.add("hotkey-" + n);
		}
		n++;
		list.appendChild(li);
	}
	if (n > 1) {
		ui.quicktags_label.innerText = "Quick Tags:";
	} else {
		ui.quicktags_label.innerText = "";
	}
	ui.quicktags.replaceChildren(list);
}

// Image Viewer
function closeViewer() {
	ui.viewer_vid.pause();
	ui.viewer.style.display = "none";
	ui.tilegrid.style.display = "grid";
	viewer_is_open = false;
	viewer_is_video = false;
	grid.activate(viewer_post, true);
	viewer_post = null;
}
ui.viewer.addEventListener("click", closeViewer);

function openViewer(post) {
	if (!post) return;
	const src = post.media_base + post.media_o[0];
	if (!viewer_is_open) {
		ui.viewer_img.src = "//:0";
	}
	viewer_is_open = true;
	viewer_post = post;
	ui.viewer_vid.pause();
	if (post.flags & flags.VIDEO) {
		viewer_is_video = true;
		ui.viewer_img.style.display = "none";
		const source = document.createElement('source');
		source.setAttribute('src', src);
		if (src.endsWith(".mp4")) {
			source.setAttribute('type', 'video/mp4');
		} else {
			source.setAttribute('type', 'video/webm');
		}
		ui.viewer_vid.style.display = "block";
		ui.viewer_vid.replaceChildren(source);
		ui.viewer_vid.load();
		ui.viewer_vid.play();
		ui.viewer_vid.volume = 0.25;
		ui.tilegrid.style.display = "none";
		ui.viewer.style.display = "flex";
	} else {
		viewer_is_video = false;
		ui.viewer_vid.style.display = "none";
		ui.viewer_img.style.display = "block";
		ui.viewer_img.src = src;
		ui.tilegrid.style.display = "none";
		ui.viewer.style.display = "flex";
	}
	sidebarShowPostInfo(post);
}

function clearTiles() {
	if (viewer_is_open) {
		closeViewer();
	}
	grid.clear();
	posts_by_id.clear();
}

function addTilesFromPosts(posts) {
	for (let post of posts) {
		let tile = document.createElement('img-tile');
		let clip = document.createElement('img-clip');
		let wrap = document.createElement('img-wrap');
		let icon = document.createElement('tile-icon');
		let img = document.createElement('img');
		img.src = post.media_base + post.media_m[0];
		tile.appendChild(clip);
		clip.appendChild(wrap);
		wrap.append(img, icon);
		if (post.flags & flags.VIDEO) {
			let tag = document.createElement('info-tag');
			tag.innerText = formatDurationTag(post.duration);
			wrap.appendChild(tag);
		}
		grid.push(post, tile);
		// bookkeeping
		posts_by_id.set(post.post_id, post);
		if (post.tags_string.length) {
			post.tags = post.tags_string.split(" ");
		} else {
			post.tags = [];
		}
	}
}

// Backend JSON API Calls

async function callUpload(filename, body, quiet) {
	try {
		const rsp = await fetch(`upload/${filename}`, {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream", },
			body: body,
			credentials: "include",
			});
		const r = await rsp.json();
		if (r.error) {
			if (!quiet) notify(`RPC ERROR: ${r.error}`);
			console.log(`RPC ERROR: ${r.error}`);
		}
		return r;
	} catch (err) {
		notify(`TRANSPORT ERROR: ${err}`);
		console.log(`TRANSPORT ERROR: ${err}`);
		return { error: "transport" };
	}
}

async function uploadFiles(work) {
	clearTiles();
	for (let w of work) {
		const r = await callUpload(w.name, w.file, true);
		if (r.error) {
			if (r.error === "duplicate") {
				w.button.classList.add("dup");
			} else {
				w.button.classList.add("fail");
				continue;
			}
		} else {
			w.button.classList.add("okay");
		}
		if (r.post_id) {
			const post = await getPostById(r.post_id);
			if (post) addTilesFromPosts([ post ]);
		}
		const p = w.button.parentNode;
		p.removeChild(w.button);
		if (p.childElementCount == 0) {
			menuClick("info");
		}
	}
}

async function callApi(api, args) {
	try {
		const rsp = await fetch(api, {
			method: "POST",
			headers: { "Content-Type": "application/json", },
			body: JSON.stringify(args),
			credentials: "include",
			});
		const r = await rsp.json();
		if (r.error) {
			notify(`RPC ERROR: ${r.error}`);
			console.log(`RPC ERROR: ${r.error}`);
		}
		return r;
	} catch (err) {
		notify(`TRANSPORT ERROR: ${err}`);
		console.log(`TRANSPORT ERROR: ${err}`);
		return { error: "transport" };
	}
}

async function getPostById(id) {
	const r = await callApi("api/getPost", { post_id: id });
	if (r.error) return null;
	return r.post;
}

async function getPosts() {
	clearTiles();
	let after = null;
	while (true) {
		const r = await callApi("api/getRecentPosts", { after: after });
		if (r.error) break;
		if (r.posts.length == 0) break;
		addTilesFromPosts(r.posts);
		after = r.posts.at(-1).post_id;
break;
	}
}

async function findPosts(query) {
	clearTiles();
	const r = await callApi("api/findPosts", { query: query.trim() });
	if (r.error) return;
	if (r.posts.length != 0) {
		addTilesFromPosts(r.posts);
	}
}

async function getTags() {
	const r = await callApi("api/getTags", {});
	if (r.error) return;
	if (r.tags.length != 0) {
		importTags(r.tags);
	}
}

async function doRemoveTagFromPost(id, name) {
	name = name.trim();
	const r = await callApi("api/removeTagFromPost", { post_id: id, tag_name: name });
	return r.error ? false : true;
}

async function doAddTagToPost(id, name) {
	name = name.trim();
	const r = await callApi("api/addTagToPost", { post_id: id, tag_name: name });
	return r.error ? false : true;
}

function tagPosts(name, posts) {
	name = name.trim();
	if (!posts) return;
	(async() => {
		for (let post of posts) {
			if (await doAddTagToPost(post.post_id, name)) {
				console.log(`TAGGED ${post.post_id} WITH ${name}`);
				post.tags.push(name);
				post.tags = post.tags.sort();
				importTag(name);
				if (post == sidebar_post) {
					sidebarShowPostInfo(post);
				}
			}
		}
	})();
}

function removeTag(name, post) {
	(async() => {
		if (await doRemoveTagFromPost(post.post_id, name)) {
			console.log(`UNTAGGED ${post.post_id} WITH ${name}`);
			post.tags = post.tags.filter(t => t !== name);
			if (post === sidebar_post) {
				sidebarShowPostInfo(post);
			}
		}
	})();
}

function applyTag(name) {
	let t;
	if (t = grid.getSelected()) {
		tagPosts(name, t);
	} else {
		tagPosts(name, [ activePost() ]);
	}
}

function setupTagCompletion(textbox, complist) {
let cache = null;
function selectItem(sel) {
	let v = textbox.value;
	if (v.endsWith(" ")) return;
	let x = v.lastIndexOf(" ");
	if (x > 0) {
		v = v.substring(0, x + 1) + sel.dataset.tag;
	} else {
		v = sel.dataset.tag;
	}
	textbox.value = v + " ";
	complist.replaceChildren();
	complist.style.display = "none";
	cache = null;
}
function updateCompList(e) {
	let v = textbox.value;
	let x = v.lastIndexOf(" ");
	if (x > 0) {
		v = v.substring(x + 1);
	}
	if (v.length == 0) {
		complist.style.display = "none";
		return;
	}
	if (v == cache) {
		complist.style.display = "block";
		return;
	}
	cache = v;
	let n = 0;
	let ul = document.createElement("ul");
	for (let tag of tags_list) {
		let idx = tag.tag.indexOf(v);
		if (idx < 0) continue;
		if ((idx > 0) && (tag.tag[idx - 1] != "_")) continue;
		let txt = tag.tag.replaceAll("_", " ");
		let li = document.createElement("li");
		li.dataset.tag = tag.tag;
		if (idx != 0) {
			let span = document.createElement("span");
			span.innerText = txt.substring(0, idx);
			li.appendChild(span);
		}
		let bold = document.createElement("strong");
		bold.innerText = v;
		li.appendChild(bold);
		idx += v.length;
		if (idx < tag.tag.length) {
			let span = document.createElement("span");
			span.innerText = txt.substring(idx);
			li.appendChild(span);
		}
		li.addEventListener("click", (e) => {
			selectItem(e.currentTarget); });
		ul.appendChild(li);
		n++;
		if (n == 20) break;
	}
	if (n > 0) {
		ul.firstElementChild.classList.add("selected");
		complist.replaceChildren(ul);
		complist.style.display = "block";
	} else {
		complist.style.display = "none";
		complist.replaceChildren();
	}
};
textbox.addEventListener("keyup", updateCompList);
textbox.addEventListener("focus", updateCompList);
textbox.addEventListener("keydown", (e) => {
	let next = null;
	let sel = null;
	switch (e.key) {
	case "ArrowDown":
		if ((sel = complist.getElementsByClassName("selected").item(0))) {
			next = sel.nextElementSibling;
		}
		break;
	case "ArrowUp":
		if ((sel = complist.getElementsByClassName("selected").item(0))) {
			next = sel.previousElementSibling;
		}
		break;
	case "Enter":
	case "Tab":
		if (!(sel = complist.getElementsByClassName("selected").item(0))) {
			return;
		}
		selectItem(sel);
		break;
	case "c":
		if (e.ctrlKey) {
			if ((sel = complist.getElementsByClassName("selected").item(0))) {
				addQuickTag(sel.dataset.tag);
				sidebarUpdateQuickTags();
				break;
			}
		}
		return;
	default:
		return;
	}
	if (next) {
		sel.classList.remove("selected");
		next.classList.add("selected");
	}
	e.preventDefault();
});
textbox.addEventListener("blur", (e) => {
	setTimeout(() => { complist.style.display = "none"; }, 500);
});
}

setupTagCompletion(ui.addtag_text, ui.addtag_comp);
setupTagCompletion(ui.search_text, ui.search_comp);

function doSearch(text) {
	ui.search_text.value = text;
	ui.search_text.blur();
	(async() => { findPosts(text); })();
}

// do this after setupTagCompletion so the completer
// handles Enter events first
ui.search_text.addEventListener("keydown", (e) => {
	let x = e.currentTarget;
	switch (e.key) {
	case "Enter":
		const v = x.value;
		(async() => { findPosts(v); })();
		x.blur();
		break;
	case "Escape":
		x.value = "";
		x.blur();
		break;
	default:
		return;
	}
	e.preventDefault();
});

ui.addtag_text.addEventListener("keydown", (e) => {
	let x = e.currentTarget;
	switch (e.key) {
	case "Enter":
		applyTag(x.value);
	case "Escape":
		x.value = "";
		x.blur();
		break;
	default:
		return;
	}
	e.preventDefault();
});

// Video Viewer Key Bindings
const vidskip = 5.000;
const vidstep = 0.040;

function videoSeekRelative(vid, delta) {
	if (!Number.isFinite(vid.duration)) return;
	vid.currentTime = Math.max(0, vid.currentTime + delta);
}

function viewerHandleKeydown(e) {
	switch (e.key) {
	case " ":
		if (ui.viewer_vid.paused || ui.viewer_vid.ended) {
			ui.viewer_vid.play();
		} else {
			ui.viewer_vid.pause();
		}
		break;
	case "m":
		ui.viewer_vid.muted = !ui.viewer_vid.muted;
		break;
/*
	case "ArrowLeft":
		videoSeekRelative(ui.viewer_vid, -vidskip);
		break;
	case "ArrowRight":
		videoSeekRelative(ui.viewer_vid, +vidskip);
		break;
*/
	case ",":
		ui.viewer_vid.pause();
		videoSeekRelative(ui.viewer_vid, -vidstep);
		break;
	case ".":
		ui.viewer_vid.pause();
		videoSeekRelative(ui.viewer_vid, +vidstep);
		break;
	default:
		return false;
	}
	event.preventDefault();
	return true;
}

document.addEventListener("keydown", (e) => {
	if (e.altKey || e.metaKey) return;
	let istextbox = (e.target.nodeName === "INPUT");

	// control-key actions are global
	if (e.ctrlKey) {
		switch (e.key) {
		case "a":
			if (istextbox) return;
			grid.selectAll();
			break;
		case "x":
			if (istextbox) return;
			grid.deselectAll();
			break;
		case "1":
			grid.setSize("128px");
			break;
		case "2":
			grid.setSize("256px");
			break;
		case "3":
			grid.setSize("384px");
			break;
		default:
			return;
		}
		e.preventDefault();
		return;
	}

	// don't interfere with standard text input
	if (istextbox) return;

	// actions for both the tilegrid and viewer
	switch (e.key) {
	case "x":
		grid.deselectAll();
		e.preventDefault();
		return;
	case "/":
		menuClick("info");
		ui.search_text.focus();
		ui.search_text.select();
		e.preventDefault();
		return;
	case "t":
		menuClick("info");
		ui.addtag_text.focus();
		ui.addtag_text.select();
		e.preventDefault();
		return;
	}

	// tilegrid actions when view is closed
	if (!viewer_is_open) {
		switch (e.key) {
		case "Enter":
			openViewer(grid.getActive());
			break;
		case ";":
			grid.toggle(grid.getActive());
			break;
		case "k": case "ArrowUp":
			grid.goNorth(true);
			break;
		case "h": case "ArrowLeft":
			grid.goWest(true);
			break;
		case "j": case "ArrowDown":
			grid.goSouth(true);
			break;
		case "l": case "ArrowRight":
			grid.goEast(true);
			break;
		case "1": case "2": case "3": case "4": case "5":
		case "6": case "7": case "8": case "9":
			const name = tags_quick[parseInt(e.key) - 1];
			if (name) {
				applyTag(name);
			}
			break;
		default:
			return;
		}
		e.preventDefault();
		return;
	}

	// viewer video controls
	if (viewer_is_video) {
		if (viewerHandleKeydown(e)) {
			return;
		}
	}

	switch (e.key) {
	case "Enter":
	case "Escape":
		closeViewer();
		break;
	case ";":
		grid.toggle(viewer_post);
		break;
	case "h": case "k": case "ArrowLeft":
		openViewer(grid.prev(viewer_post));
		break;
	case "l": case "j": case "ArrowRight":
		openViewer(grid.next(viewer_post));
		break;
	case "z":
		if (ui.viewer_img.classList.contains("img-no-zoom")) {
			ui.viewer_img.classList.remove("img-no-zoom");
		} else {
			ui.viewer_img.classList.add("img-no-zoom");
		}
		break;
	default:
		return;
	}
	event.preventDefault();
});

try {
	let ql = JSON.parse(window.localStorage.getItem(
		"net.frotz.imgbox.quicklist"));
	if (ql instanceof Array) {
		tags_quick = ql;
	}
	sidebarUpdateQuickTags();
} catch { }

// boot
ui.search_text.value = "";
ui.addtag_text.value = "";
(async() => { getPosts(); })();
(async() => { getTags(); })();
