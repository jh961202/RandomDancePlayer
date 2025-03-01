const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const crypto = require("crypto");
const path = require('path');
const fs = require('fs');

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
  // mainWindow.removeMenu();
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
    if ( playlistData.intermissionTrack !== "") {
      let intermissionAbsPath = playlistData.intermissionTrack;
      if (!path.isAbsolute(playlistData.intermissionTrack)) intermissionAbsPath = path.join(folderPath, playlistData.intermissionTrack);
      if (fs.existsSync(intermissionAbsPath)) {
        interTrack = intermissionAbsPath;
      } // if
      else {
        console.warn(`插入曲不存在，無法載入：${intermissionAbsPath}`);
      } // else

    } // if

    return {playlistPlayable: validTracks, totalTracks: playlistData.playlist.length, interMission: interTrack};
  } catch (error) {
    console.error("載入播放清單時發生錯誤:", error);
    return { error: '播放清單格式錯誤或檔案損壞，請確認後重新載入。' };
  } // catch
});
