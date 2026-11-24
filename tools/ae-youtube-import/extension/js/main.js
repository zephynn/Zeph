/*
    Panel side (Chromium + Node.js via CEP --enable-nodejs --mixed-context).
    Runs yt-dlp as a background process, shows progress, then asks the
    ExtendScript side (host/index.jsx) to import the file and place it.
    Kept to ES2017 so it runs in the oldest supported CEP (AE 2019).
*/
(function () {
  'use strict';

  var nodeRequire = typeof require === 'function' ? require : (window.cep_node && window.cep_node.require);
  if (!nodeRequire) {
    document.getElementById('status').textContent = 'Node.js is disabled for this panel. Reinstall the extension.';
    return;
  }
  var cp = nodeRequire('child_process');
  var fs = nodeRequire('fs');
  var path = nodeRequire('path');
  var os = nodeRequire('os');

  var IS_WIN = process.platform === 'win32';
  var EXT = IS_WIN ? '.exe' : '';

  // After Effects can't import VP9/AV1/Opus, so only ask YouTube for H.264 + AAC.
  // YouTube offers H.264 up to 1080p.
  var QUALITY_ARGS = {
    '1080': ['-f', 'bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=1080]',
             '--merge-output-format', 'mp4'],
    '720': ['-f', 'bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=720]',
            '--merge-output-format', 'mp4'],
    'audio': ['-f', 'ba[acodec^=mp4a]/ba', '-x', '--audio-format', 'm4a']
  };

  var $ = function (id) { return document.getElementById(id); };
  var ui = {
    url: $('url'), go: $('go'), pasteGo: $('pasteGo'), quality: $('quality'),
    folder: $('folder'), folderBtn: $('folderBtn'), fill: $('fill'), status: $('status'),
    cancel: $('cancel'), ytdlpPath: $('ytdlpPath'), ffmpegPath: $('ffmpegPath'),
    setYtdlp: $('setYtdlp'), setFfmpeg: $('setFfmpeg'), update: $('update'), setup: $('setup')
  };

  // ------------------------------------------------------------- settings

  function getSetting(key, fallback) {
    try { var v = localStorage.getItem('ytimport.' + key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function setSetting(key, value) {
    try { localStorage.setItem('ytimport.' + key, value); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ CEP glue

  function extensionPath() {
    var p = decodeURI(window.__adobe_cep__.getSystemPath('extension'));
    return IS_WIN ? p.replace('file:///', '') : p.replace('file://', '');
  }

  function evalHost(code) {
    return new Promise(function (resolve) { window.__adobe_cep__.evalScript(code, resolve); });
  }

  function applyHostTheme() {
    try {
      var env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
      var c = env.appSkinInfo.panelBackgroundColor.color;
      var rgb = 'rgb(' + Math.round(c.red) + ',' + Math.round(c.green) + ',' + Math.round(c.blue) + ')';
      document.documentElement.style.setProperty('--bg', rgb);
    } catch (e) { /* keep default dark theme */ }
  }

  // Without this, AE grabs Ctrl/Cmd+V etc. before the text box sees them on some setups.
  function claimClipboardKeys() {
    try {
      var keys = IS_WIN
        ? [{ keyCode: 86, ctrlKey: true }, { keyCode: 67, ctrlKey: true }, { keyCode: 65, ctrlKey: true }, { keyCode: 88, ctrlKey: true }]
        : [{ keyCode: 9, metaKey: true }, { keyCode: 8, metaKey: true }, { keyCode: 0, metaKey: true }, { keyCode: 7, metaKey: true }];
      window.__adobe_cep__.registerKeyEventsInterest(JSON.stringify(keys));
    } catch (e) { /* older CEP */ }
  }

  function pickFile(title) {
    var r = window.cep.fs.showOpenDialogEx(false, false, title, '', []);
    return r && r.data && r.data.length ? r.data[0] : '';
  }
  function pickFolder(title, start) {
    var r = window.cep.fs.showOpenDialogEx(false, true, title, start || '', []);
    return r && r.data && r.data.length ? r.data[0] : '';
  }

  // --------------------------------------------------------- finding tools

  function extraPathDirs() {
    if (IS_WIN) {
      var local = process.env.LOCALAPPDATA || '';
      var profile = process.env.USERPROFILE || '';
      return [
        path.join(local, 'Microsoft', 'WinGet', 'Links'),
        path.join(profile, 'scoop', 'shims'),
        'C:\\ProgramData\\chocolatey\\bin',
        'C:\\ffmpeg\\bin'
      ];
    }
    return ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), '/usr/bin'];
  }

  // CEP doesn't get the shell's PATH on macOS, so add the usual install spots.
  function childEnv() {
    var env = Object.assign({}, process.env);
    var key = IS_WIN ? (Object.keys(env).filter(function (k) { return k.toUpperCase() === 'PATH'; })[0] || 'PATH') : 'PATH';
    env[key] = extraPathDirs().concat([path.join(extensionPath(), 'bin')], (env[key] || '').split(path.delimiter))
      .filter(Boolean).join(path.delimiter);
    env.PYTHONIOENCODING = 'utf-8';
    return env;
  }

  function findTool(name) {
    var saved = getSetting(name + 'Path', '');
    if (saved && fs.existsSync(saved)) return saved;

    var dirs = [extensionPath(), path.join(extensionPath(), 'bin')]
      .concat(extraPathDirs(), (process.env.PATH || process.env.Path || '').split(path.delimiter));
    var names = IS_WIN ? [name + EXT] : [name, name + '_macos'];
    for (var i = 0; i < dirs.length; i++) {
      for (var j = 0; j < names.length; j++) {
        if (!dirs[i]) continue;
        var p = path.join(dirs[i], names[j]);
        try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* not here */ }
      }
    }
    return '';
  }

  function refreshToolLabels() {
    var y = findTool('yt-dlp'), f = findTool('ffmpeg');
    ui.ytdlpPath.textContent = y || 'not found';
    ui.ytdlpPath.title = y;
    ui.ffmpegPath.textContent = f || 'not found';
    ui.ffmpegPath.title = f;
    if (!y || !f) ui.setup.open = true;
    return { ytdlp: y, ffmpeg: f };
  }

  // ------------------------------------------------------------------- UI

  function setStatus(msg, kind) {
    ui.status.textContent = msg;
    ui.status.className = kind || '';
  }
  function setProgress(pct) { ui.fill.style.width = Math.max(0, Math.min(100, pct)) + '%'; }

  var job = null;

  function setBusy(busy) {
    ui.go.disabled = busy;
    ui.pasteGo.disabled = busy;
    ui.url.disabled = busy;
    ui.update.disabled = busy;
    ui.cancel.hidden = !busy;
  }

  function downloadFolder() {
    var saved = getSetting('downloadFolder', '');
    return saved || path.join(os.homedir(), 'Documents', 'AE YouTube Downloads');
  }

  function showFolder() {
    ui.folder.textContent = downloadFolder();
    ui.folder.title = downloadFolder();
  }

  function looksLikeUrl(s) { return /^https?:\/\/\S+$/i.test(s); }

  // ------------------------------------------------------------- download

  function lastError(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    for (var i = lines.length - 1; i >= 0; i--) if (lines[i].indexOf('ERROR') === 0) return lines[i];
    return lines.length ? lines[lines.length - 1] : 'yt-dlp exited without output.';
  }

  // Fallback if --print-to-file wrote nothing (older yt-dlp).
  function pathFromLog(log) {
    var patterns = [
      /\[Merger\] Merging formats into "(.+)"/g,
      /\[ExtractAudio\] Destination: (.+)/g,
      /\[download\] (.+) has already been downloaded/g,
      /\[download\] Destination: (.+)/g
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m, last = '';
      while ((m = patterns[i].exec(log)) !== null) last = m[1].trim();
      if (last && fs.existsSync(last)) return last;
    }
    return '';
  }

  function start(url) {
    if (job) return;
    url = (url || ui.url.value).trim();
    ui.url.value = url;
    if (!looksLikeUrl(url)) { setStatus("That doesn't look like a link.", 'error'); return; }

    var tools = refreshToolLabels();
    if (!tools.ytdlp) { setStatus('yt-dlp not found. Open Setup below and click Set…', 'error'); return; }
    if (!tools.ffmpeg) { setStatus('ffmpeg not found. Open Setup below and click Set…', 'error'); return; }

    var outDir = downloadFolder();
    try { fs.mkdirSync(outDir, { recursive: true }); }
    catch (e) { setStatus("Couldn't create folder: " + outDir, 'error'); return; }

    var pathFile = path.join(os.tmpdir(), 'ytimport_' + Date.now() + '.txt');
    var args = [
      '--no-playlist', '--restrict-filenames', '--newline', '--progress',
      '-o', path.join(outDir, '%(title).80s [%(id)s].%(ext)s'),
      '--print-to-file', 'after_move:filepath', pathFile,
      '--ffmpeg-location', tools.ffmpeg
    ].concat(QUALITY_ARGS[ui.quality.value] || QUALITY_ARGS['1080'], ['--', url]);

    var child;
    try {
      child = cp.spawn(tools.ytdlp, args, { env: childEnv(), windowsHide: true });
    } catch (e) {
      setStatus("Couldn't start yt-dlp: " + e.message, 'error');
      return;
    }

    job = { child: child, log: '', cancelled: false, pathFile: pathFile, streams: 0 };
    setBusy(true);
    setProgress(0);
    setStatus('Starting…');

    function onData(chunk) {
      var text = chunk.toString('utf8');
      job.log += text;
      var lines = text.split(/[\r\n]+/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('[download] Destination:') === 0) job.streams++;
        var m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
        if (m) {
          var pct = parseFloat(m[1]);
          setProgress(pct);
          var what = ui.quality.value === 'audio' ? 'audio' : (job.streams >= 2 ? 'audio' : 'video');
          setStatus('Downloading ' + what + '… ' + Math.round(pct) + '%');
        } else if (/^\[(Merger|ExtractAudio|FixupM3u8|VideoConvertor)\]/.test(line)) {
          setStatus('Finishing up…');
        }
      }
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', function (err) {
      finish();
      setStatus("Couldn't run yt-dlp: " + err.message, 'error');
    });

    child.on('close', function (code) {
      var current = job;
      if (!current) return;
      finish();
      if (current.cancelled) { setStatus('Cancelled.'); setProgress(0); return; }

      var filePath = '';
      try { filePath = fs.readFileSync(current.pathFile, 'utf8').trim().split(/\r?\n/).pop(); } catch (e) { /* none */ }
      try { fs.unlinkSync(current.pathFile); } catch (e) { /* none */ }
      if (!filePath || !fs.existsSync(filePath)) filePath = pathFromLog(current.log);

      if (code !== 0 || !filePath) {
        var err = lastError(current.log);
        if (/Requested format is not available/i.test(err)) {
          err = 'No H.264 version exists at that quality. Try a lower quality.';
        } else if (/Sign in to confirm|age-restricted|confirm your age/i.test(err)) {
          err = 'YouTube wants a sign-in for this video (age-restricted or bot check). Not supported yet.';
        }
        setProgress(0);
        setStatus('Failed: ' + err, 'error');
        return;
      }

      setProgress(100);
      setStatus('Importing…');
      evalHost('ytImport_importAndPlace(' + JSON.stringify(filePath) + ')').then(function (res) {
        res = String(res || '');
        if (res.indexOf('OK|') === 0) {
          setStatus(res.slice(3), 'ok');
          ui.url.value = '';
        } else {
          var msg = res.indexOf('ERR|') === 0 ? res.slice(4) : res;
          setStatus('Downloaded, but import failed: ' + msg + '\n' + filePath, 'error');
        }
      });
    });
  }

  function finish() {
    job = null;
    setBusy(false);
  }

  function cancel() {
    if (!job) return;
    job.cancelled = true;
    var pid = job.child.pid;
    if (IS_WIN) {
      // yt-dlp.exe spawns a child process (and ffmpeg); kill the whole tree.
      cp.spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      job.child.kill('SIGTERM');
    }
  }

  // Read the clipboard through the OS so it works even if AE eats Ctrl/Cmd+V.
  function readClipboard() {
    return new Promise(function (resolve) {
      var cmd = IS_WIN ? 'powershell' : 'pbpaste';
      var args = IS_WIN ? ['-NoProfile', '-Command', 'Get-Clipboard'] : [];
      cp.execFile(cmd, args, { windowsHide: true, timeout: 5000 }, function (err, out) {
        resolve(err ? '' : String(out).trim());
      });
    });
  }

  function updateYtdlp() {
    var ytdlp = findTool('yt-dlp');
    if (!ytdlp) { setStatus('yt-dlp not found.', 'error'); return; }
    setBusy(true);
    ui.cancel.hidden = true;
    setStatus('Updating yt-dlp…');
    cp.execFile(ytdlp, ['-U'], { env: childEnv(), windowsHide: true, timeout: 120000 }, function (err, out, errOut) {
      setBusy(false);
      var text = (String(out) + '\n' + String(errOut)).trim();
      if (/package manager|with pip|homebrew|brew/i.test(text)) {
        setStatus(IS_WIN ? 'Installed with winget: run "winget upgrade yt-dlp.yt-dlp" instead.'
                         : 'Installed with Homebrew: run "brew upgrade yt-dlp" in Terminal instead.', 'error');
        return;
      }
      setStatus(lastError(text) || 'Done.', err ? 'error' : 'ok');
    });
  }

  // -------------------------------------------------------------- wiring

  ui.go.addEventListener('click', function () { start(); });
  ui.url.addEventListener('keydown', function (e) { if (e.key === 'Enter') start(); });
  // Pasting a link into the box starts the download straight away.
  ui.url.addEventListener('paste', function () {
    setTimeout(function () { if (looksLikeUrl(ui.url.value.trim())) start(); }, 0);
  });
  ui.pasteGo.addEventListener('click', function () {
    readClipboard().then(function (text) {
      if (!looksLikeUrl(text)) { setStatus("Clipboard doesn't contain a link.", 'error'); return; }
      start(text);
    });
  });
  ui.cancel.addEventListener('click', cancel);

  ui.quality.value = getSetting('quality', '1080');
  ui.quality.addEventListener('change', function () { setSetting('quality', ui.quality.value); });

  ui.folderBtn.addEventListener('click', function () {
    var f = pickFolder('Download folder', downloadFolder());
    if (f) { setSetting('downloadFolder', f); showFolder(); }
  });
  ui.setYtdlp.addEventListener('click', function () {
    var f = pickFile('Locate yt-dlp');
    if (f) { setSetting('yt-dlpPath', f); refreshToolLabels(); }
  });
  ui.setFfmpeg.addEventListener('click', function () {
    var f = pickFile('Locate ffmpeg');
    if (f) { setSetting('ffmpegPath', f); refreshToolLabels(); }
  });
  ui.update.addEventListener('click', updateYtdlp);

  // Don't leave yt-dlp running if the panel is closed mid-download.
  window.addEventListener('beforeunload', cancel);

  applyHostTheme();
  claimClipboardKeys();
  showFolder();
  refreshToolLabels();
})();
