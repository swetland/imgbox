// Copyright 2026, Brian Swetland <swetland@frotz.net>
// Licensed under the Apache License, Version 2.0.

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
	infobox: ID("infobox"),
	tagsbox: ID("infotags"),
	morebox: ID("moretags"),
	text_filter: ID("filter-text"),
	suggest_filter: ID("filter-suggest"),
	text_add_tag: ID("add-tag-text"),
	label_add_tag: ID("add-tag-label"),
	suggest_add_tag: ID("add-tag-suggest"),
	viewer_vid: ID("viewer-vid"),
	viewer_img: ID("viewer-img"),
};

const posts_by_id = new Map();
let viewer_is_open = false;
let viewer_is_video = false;
let viewer_post = null;
let sidebar_post = null;

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
		activate(active ? all[active._idx + 1] : all[0], scroll);
		return active;
	}
	function goWest(scroll) {
		activate(active ? all[active._idx - 1] : all[0], scroll);
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
			ui.label_add_tag.innerText = "Add Tag (to 1 selected post):";
		} else {
			ui.label_add_tag.innerText = `Add Tag (to ${n} selected posts):`;
		}
		ui.text_add_tag.classList.add("selected");
	} else {
		ui.text_add_tag.classList.remove("selected");
		ui.label_add_tag.innerText = "Add Tag:";
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
	list.appendChild(dt);
	list.appendChild(dd);
}

function sidebarShowTags(post) {
	list = document.createElement("ul");
	for (let tag of post.tags) {
		let li = document.createElement("li");
		li.innerText = tag.replaceAll("_"," ");
		list.appendChild(li);
	}
	ui.tagsbox.replaceChildren(list);
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
	}
	ui.infobox.replaceChildren(list);
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
		wrap.appendChild(img);
		wrap.appendChild(icon);
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
async function getPosts() {
	grid.clear();
	try {
	let after = null;
	while (true) {
		const rsp = await fetch("/api/getRecentPosts", {
			method: "POST",
			headers: { "Content-Type": "application/json", },
  			body: JSON.stringify({ after: after }),
		});
		const res = await rsp.json();
		if (res.posts.length == 0) break;
		addTilesFromPosts(res.posts);
		after = res.posts.at(-1).post_id;
	}
	} catch (err) {
    		console.error(err.message);
	}
}

async function findPosts(query) {
	grid.clear();
	try {
		const rsp = await fetch("/api/findPosts", {
			method: "POST",
			headers: { "Content-Type": "application/json", },
  			body: JSON.stringify({ query: query.trim() }),
		});
		const res = await rsp.json();
		if (res.posts.length != 0) {
			addTilesFromPosts(res.posts);
		}
	} catch (err) {
    		console.error(err.message);
	}
}

async function getTags() {
	try {
		const rsp = await fetch("/api/getTags", {
			method: "POST",
			headers: { "Content-Type": "application/json", },
  			body: "{}",
		});
		const res = await rsp.json();
		if (res.tags.length != 0) {
			all_tags = res.tags;
		}
	} catch (err) {
    		console.error(err.message);
	}
}

// keyboard navigation
ui.text_filter.addEventListener("keydown", (e) => {
	let x = e.currentTarget;
	switch (e.key) {
	case "Enter":
		const v = x.value;
		x.blur();
		(async() => { findPosts(v); })();
		break;
	case "Escape":
		x.blur();
		break;
	default:
		return;
	}
	e.preventDefault();
});

async function doAddTagToPost(id, name) {
	name = name.trim();
	try {
		const rsp = await fetch("/api/addTagToPost", {
			method: "POST",
			headers: { "Content-Type": "application/json", },
  			body: JSON.stringify({ post_id: id, tag_name: name }),
		});
		const res = await rsp.json();
		console.log(`TAGGED ${id} WITH ${name}`);
		return true;
	} catch (err) {
		console.log(err);
		return false;
	}
}

function tagPosts(name, posts) {
	console.log(posts);
	name = name.trim();
	if (!posts) return;
	(async() => {
		for (post of posts) {
			if (await doAddTagToPost(post.post_id, name)) {
				post.tags.push(name);
				post.tags = post.tags.sort();
				if (post == sidebar_post) {
					sidebarShowPostInfo(post);
				}
				//TODO: update tag cache if new
			}
		}
	})();
}

function setupTagCompletion(textbox, complist) {
function updateCompList(e) {
	let v = e.currentTarget.value;
	let x = v.lastIndexOf(" ");
	if (x > 0) {
		v = v.substring(x + 1);
	}
	if (v.length == 0) {
		complist.style.display = "none";
		return;
	}
	if (v == complist.userdata) {
		complist.style.display = "block";
		return;
	}
	complist.userdata = v;
	complist.style.width = window.getComputedStyle(textbox).width;
	let n = 0;
	let ul = document.createElement("ul");
	for (let tag of all_tags) {
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
	case "Tab":
		if (!(sel = complist.getElementsByClassName("selected").item(0))) {
			return;
		}
		let v = e.currentTarget.value;
		let x = v.lastIndexOf(" ");
		if (x > 0) {
			v = v.substring(0, x + 1) + sel.dataset.tag;
		} else {
			v = sel.dataset.tag;
		}
		e.currentTarget.value = v + " ";
		break;
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
	complist.style.display = "none";
});
}

setupTagCompletion(ui.text_add_tag, ui.suggest_add_tag);
setupTagCompletion(ui.text_filter, ui.suggest_filter);

ui.text_add_tag.addEventListener("keydown", (e) => {
	let x = e.currentTarget;
	switch (e.key) {
	case "Enter":
		let t;
		if (t = grid.getSelected()) {
			tagPosts(x.value, t);
		} else if (t = grid.getActive()) {
			tagPosts(x.value, [t]);
		} else {
			break;
		}
		x.value = "";
		x.blur();
		break;
	case "Escape":
		x.blur();
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
	case "ArrowLeft":
		videoSeekRelative(ui.viewer_vid, -vidskip);
		break;
	case "ArrowRight":
		videoSeekRelative(ui.viewer_vid, +vidskip);
		break;
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
			setTileSize("128px");
			break;
		case "2":
			setTileSize("256px");
			break;
		case "3":
			setTileSize("384px");
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
	case "f":
	case "/":
		ui.text_filter.focus();
		ui.text_filter.select();
		e.preventDefault();
		return;
	case "t":
		ui.text_add_tag.focus();
		ui.text_add_tag.select();
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
		case "x":
			grid.deselectAll();
			break;
		case "f":
		case "/":
			ui.text_filter.focus();
			ui.text_filter.select();
			break;
		case "t":
			ui.text_add_tag.focus();
			ui.text_add_tag.select();
			break;
		case "w":
		case "k":
			grid.goNorth(true);
			break;
		case "a":
		case "h":
			grid.goWest(true);
			break;
		case "s":
		case "j":
			grid.goSouth(true);
			break;
		case "d":
		case "l":
			grid.goEast(true);
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
	case "a": case "w":
	case "h": case "k":
	case "ArrowLeft":
		openViewer(grid.prev(viewer_post));
		break;
	case "d": case "s":
	case "l": case "j":
	case "ArrowRight":
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

// boot
ui.text_filter.value = "";
ui.text_add_tag.value = "";
(async() => { getPosts(); })();
(async() => { getTags(); })();
