const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require("crypto");
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(path.join(process.cwd(), 'bin/ffmpeg.exe'));

let mainWindow;
app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    resizable: false,
    icon: 'images/icons/RDP.png',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile('index.html');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '音訊檔案', extensions: ['mp3', 'wav', 'ogg'] }]
  });
  return result.filePaths;
});

ipcMain.handle('open-se-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: '音訊檔案', extensions: ['mp3', 'wav', 'ogg'] }]
  });
  return result.filePaths;
});

ipcMain.handle('calculate-file-hash', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
});

ipcMain.handle('save-playlist', async (_, playlist) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Random Dance Playlist', extensions: ['rdplst'] }]
  });

  if (result.canceled || !result.filePath) {
    return null; // 使用者取消儲存
  }

  // 將 JSON 內容寫入選擇的檔案
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(playlist, null, 2), 'utf-8');
    return {
      filePath: result.filePath,
      folderPath: path.dirname(result.filePath) // 傳回存檔資料夾
    };
  } catch (error) {
    console.error("儲存播放清單時發生錯誤:", error);
    return null;
  }
});

ipcMain.handle('write-playlist-file', async (event, { filePath, playlistData }) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(playlistData, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error("儲存播放清單時發生錯誤:", error);
    return false;
  }
});

ipcMain.handle('load-playlist', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '選擇播放清單',
    filters: [{ name: 'Random Dance Playlist', extensions: ['rdplst'] }],
    properties: ['openFile']
  });

  if (result.canceled || !result.filePaths.length) return null;

  try {
    const filePath = result.filePaths[0]; // 取得選擇的 JSON 檔案
    const folderPath = path.dirname(filePath); // 取得 JSON 檔案所在目錄
    const playlistData = JSON.parse(fs.readFileSync(filePath, 'utf-8')); // 播放清單（JSON格式）
    let validTracks = [], interTrack = "";

    // 檢查播放清單
    for (const trackData of playlistData.playlist) {
      let trackAbsPath = trackData.filePath;
      if (!path.isAbsolute(trackData.filePath)) trackAbsPath = path.join(folderPath, trackData.filePath);

      if (fs.existsSync(trackAbsPath)) {
        validTracks.push({
          name: trackData.name,
          hash: trackData.fileHash,
          verified: false,
          path: trackAbsPath,
          start: trackData.startTime || 0,
          end: trackData.endTime || null,
          fadeIn: trackData.fadeIn,
          fadeOut: trackData.fadeOut
        })
      } // if
      else {
        console.warn(`檔案不存在，已忽略：${trackAbsPath}`);
      } // else

    } // for

    // 檢查插入曲（如果有）
    if (playlistData.intermissionTrack !== "") {
      let intermissionAbsPath = playlistData.intermissionTrack;
      if (!path.isAbsolute(playlistData.intermissionTrack)) intermissionAbsPath = path.join(folderPath, playlistData.intermissionTrack);
      if (fs.existsSync(intermissionAbsPath)) {
        interTrack = intermissionAbsPath;
      } // if
      else {
        console.warn(`插入曲不存在，無法載入：${intermissionAbsPath}`);
      } // else

    } // if

    return { playlistPlayable: validTracks, totalTracks: playlistData.playlist.length, interMission: interTrack };
  } catch (error) {
    console.error("載入播放清單時發生錯誤:", error);
    return { error: '播放清單格式錯誤或檔案損壞，請確認後重新載入。' };
  } // catch
});

ipcMain.handle('save-output-audio', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'MP3音訊檔案', extensions: ['mp3'] }]
  });

  if (result.canceled || !result.filePath) {
    return null; // 使用者取消儲存
  } // if
  else {
    return result.filePath;
  } // else
});

ipcMain.handle('merge-audio', async (event, playlist, intermission, outputPath) => {
  try {
    const tempDir = app.getPath("temp");
    const concatFilePath = path.join(tempDir, "concat.txt"); // 紀錄要串連的音檔
    let fileList = "";

    for (let count = 0; count < playlist.length; count++) {
      let modifiedFilePath = playlist[count].path;
      let tempOutput = path.join(tempDir, `${playlist[count].hash}_edited.mp3`); // 每首音樂的處理中繼檔案（會於之後接起來）

      // 載入檔案
      const command = ffmpeg(playlist[count].path);

      // 剪輯音檔
      if (playlist[count].start > 0 || playlist[count].end !== null) {
        command.setStartTime(playlist[count].start - 0.5);
        // 如果有淡出，則多加2秒以容納淡出的效果
        if (playlist[count].end !== null) {
          command.setDuration(playlist[count].end - playlist[count].start + (playlist[count].fadeOut ? 2 : 0.5));
        }
      } // if

      // 淡入淡出
      if (playlist[count].fadeIn) command.audioFilters("afade=t=in:st=0:d=2");
      if (playlist[count].fadeOut) command.audioFilters("afade=t=out:st=" + (playlist[count].end - playlist[count].start) + ":d=2");

      // 送交ffmpeg處理，產出中繼檔案
      await new Promise((resolve, reject) => {
        command.output(tempOutput).on("end", resolve).on("error", reject).on('start', (cmdline) => console.log(cmdline)).run();
      });

      // 檔案清單增加一項
      fileList += `file '${tempOutput.replace(/\\/g, "\\\\")}'\n`;
      // 如果有中繼音效則追加插入中繼音效，但最後一首之後不插入
      if (intermission !== "" && count < playlist.length - 1) {
        fileList += `file '${intermission.replace(/\\/g, "\\\\")}'\n`;
      } // if
      mainWindow.webContents.send("merge-progress", { step: "正在處理播放清單內的音檔", progress: (count + 1)+"/"+playlist.length });
    } // for

    // 製作總清單
    fs.writeFileSync(concatFilePath, fileList, "utf-8");

    // 以總清單正式製作銜接好的音檔
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFilePath)
        .inputOptions(["-f concat", "-safe 0"])
        .output(outputPath)
        .on("progress", (progress) => {
          mainWindow.webContents.send("merge-progress", {
            step: "正在合併音檔",
            progress: "已處理時長："+progress.timemark,
          });
        })
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    return { success: true };
  } catch (error) {
    console.error(error.message);
    return { success: false, error: error.message };
  }
});