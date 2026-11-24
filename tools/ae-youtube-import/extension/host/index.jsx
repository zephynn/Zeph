/*
    Host side (ExtendScript, ES3). Loaded by After Effects when the panel opens.
    Called from js/main.js via evalScript. Returns "OK|message" or "ERR|message"
    because ExtendScript has no JSON.
*/

function ytImport_importAndPlace(path) {
    try {
        var file = new File(path);
        if (!file.exists) return "ERR|Downloaded file not found: " + path;
        if (!app.project) app.newProject();

        app.beginUndoGroup("YouTube Import");
        try {
            var footage = app.project.importFile(new ImportOptions(file));

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
                layer.startTime = comp.time; // drop at the playhead
                return "OK|Added to \"" + comp.name + "\" at " + timeToCurrentFormat(comp.time, comp.frameRate);
            }

            // No comp open: make one that matches the footage.
            var hasVideo = footage.hasVideo && footage.width > 0;
            var w = hasVideo ? footage.width : 1920;
            var h = hasVideo ? footage.height : 1080;
            var fps = (hasVideo && footage.frameRate > 0) ? footage.frameRate : 30;
            var dur = footage.duration > 0 ? footage.duration : 10;
            // Older AE versions cap comp names at 31 characters.
            var name = footage.name.replace(/\.[^.]+$/, "").substring(0, 31);
            var newComp = app.project.items.addComp(name, w, h, hasVideo ? footage.pixelAspect : 1, dur, fps);
            newComp.parentFolder = bin;
            newComp.layers.add(footage);
            newComp.openInViewer();
            return "OK|Created comp \"" + newComp.name + "\"";
        } finally {
            app.endUndoGroup();
        }
    } catch (e) {
        return "ERR|" + e.toString();
    }
}
