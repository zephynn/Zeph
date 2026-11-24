/*
    YouTube Import — After Effects ScriptUI panel
    ---------------------------------------------
    Paste a YouTube link, press Enter (or click Download), and the video is
    downloaded with yt-dlp, imported into the project, and dropped onto the
    active comp at the playhead. If no comp is open, a new comp is made for it.

    Install:  put this file in
        Windows: C:\Program Files\Adobe\Adobe After Effects <ver>\Support Files\Scripts\ScriptUI Panels\
        macOS:   /Applications/Adobe After Effects <ver>/Scripts/ScriptUI Panels/
    then open it from Window > YouTube Import.jsx

    Needs: yt-dlp + ffmpeg (see README.md), and
           Settings > Scripting & Expressions > "Allow Scripts to Write Files and Access Network".

    ExtendScript is ES3: no let/const, no Array.indexOf, no String.trim, no JSON.
*/

(function (thisObj) {
    var SCRIPT_NAME = "YouTube Import";
    var SETTINGS = "YouTubeImport";
    var IS_WIN = $.os.indexOf("Windows") !== -1;
    var POLL_MS = 500;
    var TIMEOUT_MS = 30 * 60 * 1000; // give up after 30 minutes

    // H.264 + AAC only: After Effects cannot import VP9/AV1/Opus, which is what
    // YouTube serves by default. YouTube only offers H.264 up to 1080p.
    var QUALITIES = [
        {
            label: "Best (H.264, up to 1080p)",
            args: ["-f", "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=1080]",
                   "--merge-output-format", "mp4"]
        },
        {
            label: "720p (H.264)",
            args: ["-f", "bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=720]",
                   "--merge-output-format", "mp4"]
        },
        {
            label: "Audio only (M4A)",
            args: ["-f", "ba[acodec^=mp4a]/ba", "-x", "--audio-format", "m4a"]
        }
    ];

    // ---------------------------------------------------------------- helpers

    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }

    function getSetting(key, fallback) {
        try {
            if (app.settings.haveSetting(SETTINGS, key)) return app.settings.getSetting(SETTINGS, key);
        } catch (e) {}
        return fallback;
    }

    function setSetting(key, value) {
        try { app.settings.saveSetting(SETTINGS, key, String(value)); } catch (e) {}
    }

    function canAccessFiles() {
        try {
            return app.preferences.getPrefAsLong("Main Pref Section", "Pref_SCRIPTING_FILE_NETWORK_SECURITY") === 1;
        } catch (e) {
            return true; // pref key moved in this version; let the real call fail if it's off
        }
    }

    function readText(file) {
        if (!file.exists) return "";
        file.encoding = "UTF-8";
        if (!file.open("r")) return "";
        var text = file.read();
        file.close();
        return text;
    }

    function writeText(file, text) {
        file.encoding = "UTF-8";
        file.lineFeed = IS_WIN ? "Windows" : "Unix";
        if (!file.open("w")) throw new Error("Couldn't write " + file.fsName);
        file.write(text);
        file.close();
    }

    function firstExisting(paths) {
        for (var i = 0; i < paths.length; i++) {
            if (paths[i] && File(paths[i]).exists) return File(paths[i]).fsName;
        }
        return "";
    }

    function scriptFolder() {
        try { return File($.fileName).parent.fsName; } catch (e) { return ""; }
    }

    function findTool(name) {
        var saved = getSetting(name + "Path", "");
        if (saved && File(saved).exists) return saved;

        var here = scriptFolder();
        var candidates;
        if (IS_WIN) {
            var local = $.getenv("LOCALAPPDATA") || "";
            var profile = $.getenv("USERPROFILE") || "";
            candidates = [
                here + "\\" + name + ".exe",
                here + "\\bin\\" + name + ".exe",
                local + "\\Microsoft\\WinGet\\Links\\" + name + ".exe",
                profile + "\\scoop\\shims\\" + name + ".exe",
                "C:\\ProgramData\\chocolatey\\bin\\" + name + ".exe",
                "C:\\ffmpeg\\bin\\" + name + ".exe"
            ];
        } else {
            candidates = [
                here + "/" + name,
                here + "/bin/" + name,
                here + "/" + name + "_macos",
                "/opt/homebrew/bin/" + name,
                "/usr/local/bin/" + name,
                Folder("~").fsName + "/.local/bin/" + name
            ];
        }
        return firstExisting(candidates);
    }

    function defaultDownloadFolder() {
        var saved = getSetting("downloadFolder", "");
        if (saved && Folder(saved).exists) return saved;
        return Folder("~/Documents").fsName + (IS_WIN ? "\\" : "/") + "AE YouTube Downloads";
    }

    // Quote one argument for the generated .bat / .sh file.
    function quoteArg(arg) {
        arg = String(arg);
        if (IS_WIN) {
            // Inside a .bat file % must be doubled; quotes can't appear in our args except URLs.
            return "\"" + arg.replace(/%/g, "%%").replace(/"/g, "%%22") + "\"";
        }
        return "'" + arg.replace(/'/g, "'\\''") + "'";
    }

    // Fallback for when --print-to-file didn't write anything (e.g. older yt-dlp).
    function pathFromLog(log) {
        var patterns = [
            /\[Merger\] Merging formats into "(.+)"/g,
            /\[ExtractAudio\] Destination: (.+)/g,
            /\[download\] (.+) has already been downloaded/g,
            /\[download\] Destination: (.+)/g
        ];
        for (var p = 0; p < patterns.length; p++) {
            var m, last = "";
            while ((m = patterns[p].exec(log)) !== null) last = m[1];
            if (last && File(trim(last)).exists) return trim(last);
        }
        return "";
    }

    function lastErrorLine(log) {
        var lines = log.split(/\r?\n/);
        for (var i = lines.length - 1; i >= 0; i--) {
            if (lines[i].indexOf("ERROR") === 0) return lines[i];
        }
        for (var j = lines.length - 1; j >= 0; j--) {
            if (trim(lines[j])) return trim(lines[j]);
        }
        return "Unknown error (no output).";
    }

    // ------------------------------------------------------------ AE import

    function importAndPlace(path) {
        var file = File(path);
        if (!file.exists) throw new Error("Downloaded file not found:\n" + path);

        app.beginUndoGroup(SCRIPT_NAME);
        try {
            var io = new ImportOptions(file);
            var footage = app.project.importFile(io);

            // Keep downloads tidy in their own project folder.
            var bin = null;
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it instanceof FolderItem && it.name === "YouTube Downloads") { bin = it; break; }
            }
            if (!bin) bin = app.project.items.addFolder("YouTube Downloads");
            footage.parentFolder = bin;

            var comp = app.project.activeItem;
            if (comp instanceof CompItem) {
                var layer = comp.layers.add(footage);
                layer.startTime = comp.time; // drop it at the playhead
                return "Added to \"" + comp.name + "\" at " + timeToCurrentFormat(comp.time, comp.frameRate);
            }

            // No comp open: build one that matches the footage.
            var hasVideo = footage.hasVideo && footage.width > 0;
            var w = hasVideo ? footage.width : 1920;
            var h = hasVideo ? footage.height : 1080;
            var fps = hasVideo && footage.frameRate > 0 ? footage.frameRate : 30;
            var dur = footage.duration > 0 ? footage.duration : 10;
            // Older AE versions cap comp names at 31 characters.
            var compName = footage.name.replace(/\.[^.]+$/, "").substring(0, 31);
            var newComp = app.project.items.addComp(compName, w, h,
                hasVideo ? footage.pixelAspect : 1, dur, fps);
            newComp.parentFolder = bin;
            newComp.layers.add(footage);
            newComp.openInViewer();
            return "Created comp \"" + newComp.name + "\"";
        } finally {
            app.endUndoGroup();
        }
    }

    // ------------------------------------------------------------------- UI

    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = 10;

        var urlRow = win.add("group");
        urlRow.orientation = "row";
        urlRow.alignChildren = ["fill", "center"];
        var urlBox = urlRow.add("edittext", undefined, "", { enterKeySignalsOnChange: true });
        urlBox.helpTip = "Paste a YouTube link and press Enter";
        urlBox.preferredSize.width = 240;
        var goBtn = urlRow.add("button", undefined, "Download");
        goBtn.alignment = ["right", "center"];

        var optRow = win.add("group");
        optRow.orientation = "row";
        optRow.alignChildren = ["left", "center"];
        var qualityList = optRow.add("dropdownlist");
        for (var q = 0; q < QUALITIES.length; q++) qualityList.add("item", QUALITIES[q].label);
        qualityList.selection = parseInt(getSetting("quality", "0"), 10) || 0;

        var folderRow = win.add("group");
        folderRow.orientation = "row";
        folderRow.alignChildren = ["fill", "center"];
        var folderText = folderRow.add("statictext", undefined, defaultDownloadFolder(), { truncate: "middle" });
        folderText.preferredSize.width = 220;
        var folderBtn = folderRow.add("button", undefined, "Folder…");
        folderBtn.alignment = ["right", "center"];

        var progress = win.add("progressbar", undefined, 0, 100);
        progress.preferredSize.height = 6;

        var status = win.add("statictext", undefined, "Paste a link to get started.", { multiline: true, truncate: "end" });
        status.preferredSize.height = 34;

        var toolRow = win.add("group");
        toolRow.orientation = "row";
        toolRow.alignment = ["fill", "bottom"];
        var setupBtn = toolRow.add("button", undefined, "Set yt-dlp…");
        var ffBtn = toolRow.add("button", undefined, "Set ffmpeg…");
        var updateBtn = toolRow.add("button", undefined, "Update yt-dlp");

        function setStatus(msg) { status.text = msg; }

        // -------------------------------------------------------- handlers

        qualityList.onChange = function () {
            if (qualityList.selection) setSetting("quality", qualityList.selection.index);
        };

        folderBtn.onClick = function () {
            var f = Folder(folderText.text).exists ? Folder(folderText.text).selectDlg("Download folder")
                                                   : Folder.selectDialog("Download folder");
            if (f) {
                folderText.text = f.fsName;
                setSetting("downloadFolder", f.fsName);
            }
        };

        function pickTool(name) {
            var f = File.openDialog("Locate " + name + (IS_WIN ? ".exe" : ""));
            if (f) {
                setSetting(name + "Path", f.fsName);
                setStatus(name + " set to " + f.fsName);
            }
        }
        setupBtn.onClick = function () { pickTool("yt-dlp"); };
        ffBtn.onClick = function () { pickTool("ffmpeg"); };

        updateBtn.onClick = function () {
            var ytdlp = findTool("yt-dlp");
            if (!ytdlp) { setStatus("yt-dlp not found. Click \"Set yt-dlp…\"."); return; }
            setStatus("Updating yt-dlp…");
            win.update && win.update();
            try {
                var exe = IS_WIN ? "\"" + ytdlp + "\"" : quoteArg(ytdlp);
                var out = system.callSystem(exe + " -U");
                setStatus(trim(out).split(/\r?\n/).pop() || "Done.");
            } catch (e) {
                setStatus("Update failed: " + e.message);
            }
        };

        function setBusy(busy) {
            goBtn.enabled = !busy;
            urlBox.enabled = !busy;
            updateBtn.enabled = !busy;
            if (!busy) progress.value = 0;
        }

        // ---------------------------------------------- background download

        // app.scheduleTask runs a string of code in the global scope, so the
        // poll function has to be reachable from $.global.
        var job = null;

        function startDownload() {
            if (job) return;
            var url = trim(urlBox.text);
            if (!/^https?:\/\//i.test(url)) { setStatus("That doesn't look like a link."); return; }
            if (!canAccessFiles()) {
                alert("Turn on \"Allow Scripts to Write Files and Access Network\" in\n" +
                      "Settings > Scripting & Expressions, then try again.", SCRIPT_NAME);
                return;
            }

            var ytdlp = findTool("yt-dlp");
            if (!ytdlp) {
                setStatus("yt-dlp not found. Click \"Set yt-dlp…\" to locate it.");
                return;
            }
            var ffmpeg = findTool("ffmpeg");

            var outFolder = Folder(folderText.text);
            if (!outFolder.exists && !outFolder.create()) {
                setStatus("Couldn't create folder:\n" + outFolder.fsName);
                return;
            }

            var id = "ytimport_" + new Date().getTime();
            var tmp = Folder.temp.fsName + (IS_WIN ? "\\" : "/");
            var files = {
                log: File(tmp + id + ".log"),
                path: File(tmp + id + ".path"),
                done: File(tmp + id + ".done"),
                runner: File(tmp + id + (IS_WIN ? ".bat" : ".sh")),
                launcher: File(tmp + id + ".vbs")
            };

            var sep = IS_WIN ? "\\" : "/";
            var args = [
                "--no-playlist", "--restrict-filenames", "--newline", "--progress",
                "--encoding", "utf-8",
                "-o", outFolder.fsName + sep + "%(title).80s [%(id)s].%(ext)s",
                "--print-to-file", "after_move:filepath", files.path.fsName
            ];
            var preset = QUALITIES[qualityList.selection ? qualityList.selection.index : 0];
            args = args.concat(preset.args);
            if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);
            args.push("--", url);

            var cmd = quoteArg(ytdlp);
            for (var i = 0; i < args.length; i++) cmd += " " + quoteArg(args[i]);

            try {
                if (IS_WIN) {
                    // Leading blank line absorbs a BOM if ExtendScript writes one.
                    writeText(files.runner,
                        "\r\n@echo off\r\nchcp 65001 >nul\r\nset PYTHONIOENCODING=utf-8\r\n" +
                        cmd + " > " + quoteArg(files.log.fsName) + " 2>&1\r\n" +
                        ">" + quoteArg(files.done.fsName) + " echo %ERRORLEVEL%\r\n");
                    // wscript returns immediately and runs the .bat with no console window.
                    writeText(files.launcher,
                        "CreateObject(\"WScript.Shell\").Run \"cmd /c \"\"" + files.runner.fsName + "\"\"\", 0, False\r\n");
                    system.callSystem("wscript.exe \"" + files.launcher.fsName + "\"");
                } else {
                    writeText(files.runner,
                        "#!/bin/sh\n" +
                        "export PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"\n" +
                        "export LC_ALL=en_US.UTF-8\n" +
                        cmd + " > " + quoteArg(files.log.fsName) + " 2>&1\n" +
                        "echo $? > " + quoteArg(files.done.fsName) + "\n");
                    system.callSystem("/bin/sh " + quoteArg(files.runner.fsName) + " > /dev/null 2>&1 &");
                }
            } catch (e) {
                setStatus("Couldn't start yt-dlp: " + e.message);
                return;
            }

            job = { files: files, started: new Date().getTime(), taskId: 0 };
            setBusy(true);
            progress.value = 0;
            setStatus("Starting download…");
            job.taskId = app.scheduleTask("$.global.__YouTubeImportPoll()", POLL_MS, true);
        }

        function cleanup() {
            if (!job) return;
            try { app.cancelTask(job.taskId); } catch (e) {}
            var f = job.files; // the log is kept on failure so the user can read it
            f.path.remove(); f.done.remove(); f.runner.remove(); f.launcher.remove();
            job = null;
            setBusy(false);
        }

        function poll() {
            if (!job) return;
            var f = job.files;
            var log = readText(f.log);

            if (!f.done.exists) {
                if (new Date().getTime() - job.started > TIMEOUT_MS) {
                    cleanup();
                    setStatus("Timed out. Log: " + f.log.fsName);
                    return;
                }
                // "[download]  42.0% of ..." — show the newest percentage.
                var m, pct = -1, re = /\[download\]\s+(\d+(?:\.\d+)?)%/g;
                while ((m = re.exec(log)) !== null) pct = parseFloat(m[1]);
                if (pct >= 0) {
                    progress.value = pct;
                    setStatus("Downloading… " + Math.round(pct) + "%");
                } else if (log.indexOf("[Merger]") !== -1 || log.indexOf("[ExtractAudio]") !== -1) {
                    setStatus("Finishing up…");
                }
                return;
            }

            var code = parseInt(trim(readText(f.done)), 10);
            var path = trim(readText(f.path)).split(/\r?\n/).pop();
            if (!path || !File(path).exists) path = pathFromLog(log);

            if (code !== 0 || !path) {
                var err = lastErrorLine(log);
                cleanup();
                if (/Requested format is not available/i.test(err)) {
                    err = "No H.264 version of this video exists at that quality. Try a lower quality.";
                }
                setStatus("Failed: " + err);
                return;
            }

            cleanup();
            f.log.remove();
            try {
                progress.value = 100;
                setStatus(importAndPlace(path));
                urlBox.text = "";
            } catch (e) {
                setStatus("Downloaded, but import failed: " + e.message);
            }
        }

        $.global.__YouTubeImportPoll = function () {
            try { poll(); } catch (e) { cleanup(); setStatus("Error: " + e.message); }
        };

        goBtn.onClick = startDownload;
        urlBox.onChange = startDownload;

        win.onResizing = win.onResize = function () { this.layout.resize(); };
        win.layout.layout(true);
        return win;
    }

    var ui = buildUI(thisObj);
    if (ui instanceof Window) { ui.center(); ui.show(); }
})(this);
