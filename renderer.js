const { ipcRenderer } = require('electron');
const Sortable = require('sortablejs');
const Swal = require('sweetalert2');
const path = require('path');
const $ = require('jquery');
require('ion-rangeslider');

window.$ = window.jQuery = $; // 確保全域可用
const playlistElement = document.getElementById('playlist');
const audioPlayer = document.getElementById('audio-player');
const intermissionAudioPlayer = document.getElementById('soundeffectsInBetween-player');
const mainPlayerControl = document.getElementById('mainPlayer-control');
const intermissionPlayerControl = document.getElementById('intermissionPlayer-control')
const shuffleButton = document.getElementById("shuffleButton");

let playlist = [], originalPlaylist = []; // 顯示給使用者的播放清單，以及隨機模式時快取的原始播放清單
let currentIndex = 0;
let isShuffleMode = false;
let intermissionTrack = "";
let isIntermissionPlaying = false;
let trackEndCheckInterval = null;

// 初始化拖放排序功能
new Sortable(playlistElement, {
  animation: 150,
  onEnd: (evt) => {
    const movedItem = playlist.splice(evt.oldIndex, 1)[0];
    playlist.splice(evt.newIndex, 0, movedItem);
    renderPlaylist();
  }
});

// 選擇音樂檔案
document.getElementById('select-files').addEventListener('click', async () => {
  const files = await ipcRenderer.invoke('open-file-dialog');
  if (files.length) {
    const updatedPlaylist = await Promise.all(files.map(async (file) => {
      const hashValue = await ipcRenderer.invoke('calculate-file-hash', file); // 計算 SHA-256 雜湊值
      return { name: '', path: file, hash: hashValue, verified: true, start: 0, end: null, fadeIn: false, fadeOut: false };
    }));
    playlist.push(...updatedPlaylist);
    renderPlaylist();
  }
});

// 選擇間隔音效
document.getElementById("select-soundeffectsInBetween").addEventListener("click", async () => {
  const files = await ipcRenderer.invoke('open-se-dialog');
  if (files.length > 0) {
    intermissionTrack = files[0];
    intermissionAudioPlayer.src = intermissionTrack;
    Swal.fire({
      theme: 'auto',
      title: "間隔音效已選擇",
      text: files[0].split('/').pop(),
      icon: "success"
    });
  }
});

// 儲存播放清單
document.getElementById('save-playlist').addEventListener('click', () => {
  if (!playlist.length) {
    Swal.fire({
      theme: 'auto',
      title: '請先加入曲目',
      text: '請使用「加入音樂」按鈕加入要播放的音樂，才能另存成播放清單',
      icon: 'warning',
      footer: '加入曲目後，可以使用拖拉的方式對音樂檔案進行排序'
    })
  } // if
  else {
    Swal.fire({
      theme: 'auto',
      title: "選擇儲存方式",
      text: "要儲存為絕對路徑或相對路徑？",
      icon: "question",
      showCancelButton: true,
      allowOutsideClick: false,
      confirmButtonText: "絕對路徑",
      cancelButtonText: "相對路徑"
    }).then(async (result) => {
      const useAbsolutePath = result.isConfirmed;
      const { filePath, folderPath } = await ipcRenderer.invoke('save-playlist', playlist);

      const playlistData = {
        version: 1,
        playlist: playlist.map(item => ({
          name: item.name,
          filePath: useAbsolutePath ? item.path : path.relative(folderPath, item.path),
          fileHash: item.hash,
          startTime: item.start || 0,
          endTime: item.end || null,
          fadeIn: item.fadeIn,
          fadeOut: item.fadeOut
        })),
        intermissionTrack: useAbsolutePath ? intermissionTrack : path.relative(folderPath, intermissionTrack)
      };

      await ipcRenderer.invoke('write-playlist-file', { filePath, playlistData });
      Swal.fire({ theme: 'auto', title: "播放清單已儲存", text: `儲存於: ${filePath}`, icon: "success" });
    });
  } // else

});

// 儲存音檔
document.getElementById('make-audio').addEventListener('click', async () => {
  if (!playlist.length) {
    Swal.fire({
      theme: 'auto',
      title: '請先加入曲目',
      text: '本功能需要在播放清單內有曲目時才能使用',
      icon: 'info'
    })
    return;
  } // if
  
  mergeAudioNotice.showModal();
});

document.getElementById('make-audio-start').addEventListener('click', async () => {
  const mergeProgressDisplay = document.getElementById('mergeProgress');
  const mergeStartBtn = document.getElementById('make-audio-start');
  const cancelBtn = document.getElementById('cancelBtn');

  if (!playlist.length) {
    Swal.fire({
      theme: 'auto',
      title: '請先加入曲目',
      text: '本功能需要在播放清單內有曲目時才能使用',
      icon: 'info'
    })
    return;
  } // if

  const savePath = await ipcRenderer.invoke('save-output-audio');
  if (!savePath.length) return;

  mergeStartBtn.disabled = true;
  cancelBtn.disabled = true;
  mergeProgressDisplay.innerHTML = "<span class=\"loading loading-dots loading-md\"></span> 正在準備開始作業，過程中請不要關閉本程式...";

  const mergeFileResult = await ipcRenderer.invoke('merge-audio', playlist, intermissionTrack, savePath);
  if (mergeFileResult.success) {
    mergeProgressDisplay.innerHTML = "";
    const mergeSuccessModal = document.createElement('div');
    mergeSuccessModal.setAttribute('role', 'alert');
    mergeSuccessModal.setAttribute('class', 'alert alert-success');
    const mergeSuccessText = document.createElement('span');
    mergeSuccessText.innerHTML = "<i class=\"bi bi-check2-circle\"></i> 輸出的串燒已儲存到：" + savePath;
    mergeSuccessModal.appendChild(mergeSuccessText);
    mergeProgressDisplay.appendChild(mergeSuccessModal);
  } // if
  else {
    mergeProgressDisplay.innerHTML = "";
    const mergeFailModal = document.createElement('div');
    mergeFailModal.setAttribute('role', 'alert');
    mergeFailModal.setAttribute('class', 'alert alert-error');
    const mergeFailText = document.createElement('span');
    mergeFailText.innerHTML = "<i class=\"bi bi-exclamation-triangle\"></i> 發生錯誤，請參看以下訊息：" + mergeFileResult.error;
    mergeFailModal.appendChild(mergeFailText);
    mergeProgressDisplay.appendChild(mergeFailModal);
  } // else

  mergeStartBtn.disabled = false;
  cancelBtn.disabled = false;
});

// 載入播放清單
document.getElementById('load-playlist').addEventListener('click', async () => {
  Swal.fire({
    theme: 'auto',
    icon: 'info',
    title: '選擇播放清單檔案',
    text: '請在開啟的選擇檔案視窗中，挑選先前儲存的播放清單檔案',
    showConfirmButton: false
  });
  const response = await ipcRenderer.invoke('load-playlist');
  if (!response) {
    Swal.fire({ theme: 'auto', title: "載入取消", text: "未載入播放清單", icon: "info" });
    return;
  } // if

  const { playlistPlayable, totalTracks, interMission } = response;
  if (playlistPlayable === 0) {
    Swal.fire({
      theme: 'auto',
      icon: 'error',
      title: '無法載入播放清單',
      text: '播放清單內的所有檔案都無法使用，請確認檔案是否存在。',
    });
    return;
  } // if

  const verifiedPlaylist = await Promise.all(playlistPlayable.map(async (trackItem) => {
    const hashValue = await ipcRenderer.invoke('calculate-file-hash', trackItem.path); // 計算 SHA-256 雜湊值
    if (hashValue === trackItem.hash) {
      return {
        name: trackItem.name,
        path: trackItem.path,
        hash: trackItem.hash,
        verified: true,
        start: trackItem.start,
        end: trackItem.end,
        fadeIn: trackItem.fadeIn,
        fadeOut: trackItem.fadeOut
      };

    } // if
    else {
      return trackItem;
    }

  }));

  intermissionTrack = interMission;
  intermissionAudioPlayer.src = interMission;
  // 如果檢測到播放清單中已有曲目，則詢問是否要附加或清空後載入
  if (playlist.length) {
    Swal.fire({
      theme: 'auto',
      title: "播放清單中還有曲目",
      text: "您要清空整個播放清單後再載入，還是直接將讀入的播放清單加在現有的之後？",
      icon: "question",
      footer: '間隔音效將會套用載入的播放清單內的選項',
      showCancelButton: true,
      showDenyButton: true,
      allowOutsideClick: false,
      confirmButtonText: "清空後載入",
      denyButtonText: "附加在後",
      cancelButtonText: "不載入"
    }).then((result) => {
      if (result.isConfirmed) {
        playlist = [];
        playlist.push(...verifiedPlaylist);
        renderPlaylist();
        checkPlaylistHealth(totalTracks);
      } // if
      else if (result.isDenied) {
        playlist.push(...verifiedPlaylist);
        renderPlaylist();
        checkPlaylistHealth(totalTracks);
      } // else if
    });
  } // if
  else {
    playlist.push(...verifiedPlaylist);

    renderPlaylist();
    checkPlaylistHealth(totalTracks);
    Swal.close();
  } // else


});

// 檢查播放清單是否有問題，有問題則顯示提示
function checkPlaylistHealth(totalTracks) {
  let unverifiedTrack = 0;
  const loadWarningContent = document.getElementById('loadWarningContent');

  playlist.forEach((track, index) => {
    if (!track.verified) {
      ++unverifiedTrack;
    } // if
  });

  if (totalTracks - playlist.length) {
    const warning_title = document.createElement('h4');
    warning_title.setAttribute('class', 'text-lg');
    warning_title.textContent = "清單內有檔案無法載入";
    const warning_body = document.createElement('p');
    warning_body.textContent = "有" + (totalTracks - playlist.length) + "首曲目因為找不到檔案而無法加入清單中，請確認音檔是否有不慎改動檔案名稱等情事。";

    loadWarningContent.appendChild(warning_title);
    loadWarningContent.appendChild(warning_body);
  } // if

  if (unverifiedTrack) {
    const warning_title = document.createElement('h4');
    warning_title.setAttribute('class', 'text-lg');
    warning_title.textContent = "清單內有檔案驗證失敗";
    const warning_body = document.createElement('p');
    warning_body.textContent = "檢測到共有" + unverifiedTrack + "首曲目與當初加入播放清單時的雜湊值不符，這可能代表音檔有被抽換過或者發生問題，強烈建議您再次確認播放的內容是否正確無誤；有問題的曲目檔案路徑會以紅字顯示";

    loadWarningContent.appendChild(warning_title);
    loadWarningContent.appendChild(warning_body);
  } // if

  if (intermissionTrack === "") {
    const warning_title = document.createElement('h4');
    warning_title.setAttribute('class', 'text-lg');
    warning_title.textContent = "沒有間隔音效或間隔音效無法載入";
    const warning_body = document.createElement('p');
    warning_body.textContent = "此播放清單中似乎沒有間隔音效，或者間隔音效檔案因故無法載入，建議您手動自行加入間隔音效。";

    loadWarningContent.appendChild(warning_title);
    loadWarningContent.appendChild(warning_body);
  } // if

  if (unverifiedTrack || intermissionTrack === "") {
    const closingBtnDiv = document.createElement('div');
    closingBtnDiv.setAttribute('class', 'modal-action');
    const closingBtnForm = document.createElement('form');
    closingBtnForm.setAttribute('method', 'dialog');
    const closingBtn = document.createElement('button');
    closingBtn.setAttribute('class', 'btn');
    closingBtn.textContent = "我已了解";

    closingBtnForm.appendChild(closingBtn);
    closingBtnDiv.appendChild(closingBtnForm);
    loadWarningContent.appendChild(closingBtnDiv);
    playlistLoadWarning.showModal();
  }
} // checkPlaylistHealth

// 渲染播放清單
function renderPlaylist() {
  playlistElement.innerHTML = '';
  playlist.forEach((track, index) => {
    const li = document.createElement('li');
    li.setAttribute('data-index', index);
    li.setAttribute('class', 'playlist-item list-row');

    const songIndex = document.createElement('div');
    songIndex.setAttribute('class', 'text-4xl font-thin opacity-30 tabular-nums');
    songIndex.setAttribute('id', 'trackNo-' + index);
    songIndex.textContent = (index + 1);
    const songInfo = document.createElement('div');
    const songTitle = document.createElement('div');
    songTitle.setAttribute('class', 'fileName cursor-pointer hover:text-500 hover:brightness-125');
    songTitle.textContent = track.name === '' ? "曲目" + (index + 1) : track.name;
    songTitle.addEventListener('click', () => playTrack(index));
    const songPath = document.createElement('div');
    songPath.setAttribute('class', track.verified ? 'text-xs font-semibold opacity-60' : 'text-xs font-semibold text-red-500 opacity-60'); // 如果檔案驗證失敗，會變成紅字
    songPath.textContent = track.path.split('/').pop();

    const editBtn = document.createElement('button');
    editBtn.setAttribute('class', 'btn btn-square btn-ghost editBtn');
    editBtn.innerHTML = '<i class=\"bi bi-pencil-square\"></i>';
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      editTrackSegment(index);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.setAttribute('class', 'btn btn-square btn-ghost deleteBtn');
    deleteBtn.innerHTML = '<i class=\"bi bi-trash\"></i>';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      confirmRemoveTrack(index);
    });

    // 串接元件階層
    li.appendChild(songIndex);
    li.appendChild(songInfo);
    songInfo.appendChild(songTitle);
    songInfo.appendChild(songPath);
    li.appendChild(editBtn);
    li.appendChild(deleteBtn);
    playlistElement.appendChild(li);
  });
}

// 設定播放區間
async function editTrackSegment(index) {
  const track = playlist[index];
  let currentTime = audioPlayer.currentTime;

  try {
    const duration = await getTrackDuration(track.path);
    if (!duration || isNaN(duration)) {
      throw new Error("無法讀取音樂時長");
    }

    let newStart = track.start ?? 0;
    let newEnd = track.end ?? duration;
    let newName = track.name;
    let newFadeIn = track.fadeIn;
    let newFadeOut = track.newFadeOut;

    Swal.fire({
      theme: 'auto',
      title: '設定播放區間',
      html: `
      <div class="flex flex-col items-center gap-y-2 p-6 bg-base-300 rounded-lg w-full max-w-lg mx-auto">
        <label class="input input-bordered flex items-center gap-2 w-full">
          曲目名稱
          <input type="text" class="grow" id="customName" placeholder="未輸入則顯示在播放清單中的序號" value="${track.name}"/>
        </label>
        <div class="card bg-base-100 w-full shadow-xl">
          <div class="card-body">
            <h2 class="card-title">播放區間</h2>
            <input id="range-slider" type="text" />
          </div>
        </div>
        
        <div class="form-control w-full flex flex-col gap-2">
          <label class="flex justify-between">
            <span class="label-text">啟用淡入</span>
            <input type="checkbox" class="toggle" id="fade-in" ${track.fadeIn ? 'checked' : ''} />
          </label>
          <label class="flex justify-between">
            <span class="label-text">啟用淡出</span>
            <input type="checkbox" class="toggle" id="fade-out" ${track.fadeOut ? 'checked' : ''} />
          </label>
        </div>
      </div>
      `,
      footer: "曲目路徑：" + track.path,
      didOpen: () => {
        $('#range-slider').ionRangeSlider({
          type: 'double',
          min: 0,
          max: duration,
          from: newStart,
          to: newEnd,
          prettify: formatTime,
          onFinish: (data) => {
            newStart = data.from;
            newEnd = data.to;
          }
        });
      },
      confirmButtonText: '確定',
      preConfirm: () => {
        newName = document.getElementById('customName').value;
        newFadeIn = document.getElementById('fade-in').checked;
        newFadeOut = document.getElementById('fade-out').checked;

        currentTime = audioPlayer.currentTime;
        return new Promise((resolve) => {
          if (newEnd < currentTime && index === currentIndex) {
            // **如果新的結束時間比目前播放位置還早，且是正在播放的曲目**
            Swal.fire({
              theme: 'auto',
              title: '播放即將結束',
              text: '您設定的結束時間比目前播放進度還要早，曲目將立即停止或切換到下一首，是否繼續？',
              icon: 'warning',
              showCancelButton: true,
              confirmButtonText: '是',
              cancelButtonText: '否'
            }).then((result) => {
              if (result.isConfirmed) {
                updateTrackSegment(index, newName, newStart, newEnd, newFadeIn, newFadeOut);
                playNextTrack(); // 直接切換
              }
              resolve(); // 確保 Promise resolve
            });
          } else {
            // **正常套用播放區間**
            updateTrackSegment(index, newName, newStart, newEnd, newFadeIn, newFadeOut);
            resolve();
          }
        });
      }
    });

  } catch (error) {
    console.error("錯誤：", error);
    Swal.fire({
      theme: 'auto',
      title: '錯誤',
      text: '無法讀取曲目長度，請確認檔案是否有效。',
      icon: 'error'
    });
  }
}

// 更新曲目的設定
function updateTrackSegment(index, name, start, end, fadeIn, fadeOut) {
  playlist[index].name = name;
  playlist[index].start = start;
  playlist[index].end = end;
  playlist[index].fadeIn = fadeIn;
  playlist[index].fadeOut = fadeOut;

  if (index === currentIndex) {
    if (audioPlayer.currentTime < start) {
      audioPlayer.currentTime = start;
    }
    startTrackEndCheck(end);
  }

  renderPlaylist();
}

// 獲取音樂長度
function getTrackDuration(path) {
  return new Promise((resolve, reject) => {
    const tempAudio = new Audio();
    tempAudio.src = path;
    tempAudio.addEventListener('loadedmetadata', () => {
      resolve(Math.floor(tempAudio.duration));
    });
    tempAudio.addEventListener('error', () => {
      reject("音樂檔案無法讀取");
    });
  });
}

// 轉換秒數為 `分鐘:秒` 格式
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

// 確認刪除曲目
function confirmRemoveTrack(index) {
  // 檢查是否正在播放 & 是否要刪除的曲目是當前播放曲目
  const isPlaying = currentIndex === index && !audioPlayer.paused;

  if (isPlaying) {
    Swal.fire({
      theme: 'auto',
      title: '正在播放',
      text: '該曲目正在播放，確定要刪除嗎？',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: '確定',
      cancelButtonText: '取消'
    }).then((result) => {
      if (result.isConfirmed) {
        removeTrack(index);
      }
    });
  } else {
    removeTrack(index);
  }
} // confirmRemoveTrack

// 刪除曲目
function removeTrack(index) {
  const wasPlaying = currentIndex === index;
  playlist.splice(index, 1); // 移除曲目

  if (wasPlaying) { // 如果刪除的曲目正在被播放，則清空播放器
    audioPlayer.src = '';
    currentIndex = -1;
    mainPlayerControl.innerHTML = "<i class=\"bi bi-play-fill\"></i><span class=\"dock-label\" id=\"mainPlayer-label\">主音樂未播放</span>";
  } else if (index < currentIndex) { // 如果刪除的是在播放曲目之前的曲目，則調整 currentIndex（反之則不用動）
    currentIndex--;
  }

  renderPlaylist();
} // removeTrack

// 載入曲目但不自動播放
function loadTrack(index) {
  currentIndex = index;
  const track = playlist[currentIndex];
  audioPlayer.src = track.path;
  audioPlayer.currentTime = track.start;
}

// 播放曲目，加入淡入淡出效果
function playTrack(index) {
  currentIndex = index;
  let track = playlist[index];

  audioPlayer.src = track.path;
  audioPlayer.currentTime = track.start || 0;

  if (track.fadeIn) {
    audioPlayer.volume = 0;
    audioPlayer.play();
    fadeInAudio(2000); // 2秒淡入
  } else {
    audioPlayer.volume = 1;
    audioPlayer.play();
  }

  startTrackEndCheck(track.end);
  // updateTrackEndTimer(track.end);
}

// 淡入效果
function fadeInAudio(duration) {
  let volume = 0;
  const step = 1 / (duration / 100); // 計算每100ms增加的音量
  const fadeInterval = setInterval(() => {
    if (volume < 1) {
      volume += step;
      audioPlayer.volume = Math.min(volume, 1);
    } else {
      clearInterval(fadeInterval);
    }
  }, 100);
}

// 追蹤播放進度
function startTrackEndCheck(endTime) {
  clearInterval(trackEndCheckInterval); // 先清除之前的檢查，避免重複執行

  if (endTime) {
    trackEndCheckInterval = setInterval(() => {
      // 監測是否已經到了結束播放點
      if (!audioPlayer.paused && audioPlayer.currentTime >= endTime) {
        clearInterval(trackEndCheckInterval);
        playNextTrack();
      }
    }, 500); // 每 500ms 檢查一次
  }
}

// 播放下一首時淡出
function playNextTrack() {
  const track = playlist[currentIndex];
  if (track.fadeOut) {
    // 需要淡出效果
    fadeOutAudio(2000, () => {
      // 移動至間隔音效處理機制（已包含確認是否有間隔音效，且播放間隔音效的函數包含自動切下一首的機制，無須再返回處裡）
      audioPlayer.pause();
      if (currentIndex < playlist.length - 1) playIntermissionSound();
    });
  } else {
    // 不須淡出，直接暫停之後播放間隔音效
    audioPlayer.pause();
    if (currentIndex < playlist.length - 1) playIntermissionSound();
  }
}

// 淡出效果
function fadeOutAudio(duration, callback) {
  let volume = 1;
  const step = 1 / (duration / 100);
  const fadeInterval = setInterval(() => {
    if (volume > 0) {
      volume -= step;
      audioPlayer.volume = Math.max(volume, 0);
    } else {
      clearInterval(fadeInterval);
      callback();
    }
  }, 100);
}

// 監聽主播放器音樂結束事件，在切換下一首時自動播放間隔音效
audioPlayer.addEventListener('ended', () => {
  playIntermissionSound()
});

// 播放間隔音效
function playIntermissionSound() {
  if (intermissionTrack && !isIntermissionPlaying && currentIndex < playlist.length - 1) {
    isIntermissionPlaying = true;
    intermissionAudioPlayer.play();
    intermissionPlayerControl.innerHTML = "<i class=\"bi bi-pause-fill\"></i><span class=\"dock-label\" id=\"intermissionPlayer-label\">間隔音播放中</span>";
  } else {
    isIntermissionPlaying = false;
    intermissionPlayerControl.innerHTML = "<i class=\"bi bi-play-fill\"></i><span class=\"dock-label\" id=\"intermissionPlayer-label\">間隔音未播放</span>";
    playTrack(currentIndex + 1);
  }
} // playIntermissionSound

// 監聽間隔音效結束事件，在結束時自動放下一首
intermissionAudioPlayer.addEventListener("ended", () => {
  isIntermissionPlaying = false;
  intermissionPlayerControl.innerHTML = "<i class=\"bi bi-play-fill\"></i><span class=\"dock-label\" id=\"intermissionPlayer-label\">間隔音未播放</span>";
  if (!playlist.length) {
    Swal.fire({
      theme: 'auto',
      title: '播放清單裡面沒有曲目',
      text: '請加入音樂，在間隔音播放完畢後就會自動連播您加入的曲目',
      icon: 'info',
      footer: '你還可以設定每首歌要播放的區間與是否要淡入淡出，以符合你的需求！'
    })
  } // if
  else {
    playTrack(currentIndex + 1);
  } // else

});

// 隨機播放按鈕
shuffleButton.addEventListener("click", () => {
  if (!isShuffleMode) {
    // 進入隨機播放模式
    if (playlist.length === 0) {
      Swal.fire({
        theme: 'auto',
        title: '請先加入曲目',
        text: '要使用隨機播放功能，請先準備好要隨機播放的曲目',
        icon: 'info',
        footer: '加入曲目後，也可以先設定每首歌要播放的區間與是否要淡入淡出，啟動隨機播放時就可正常帶入'
      })
    } // if
    else {
      Swal.fire({
        theme: 'auto',
        title: "隨機播放模式已啟動",
        icon: "info"
      });
      shufflePlaylist();
      shuffleButton.innerHTML = "<i class=\"bi bi-sign-stop\"></i></i><span class=\"dock-label\">結束隨機播放</span>";
      isShuffleMode = true;
    }
  } else {
    // 離開隨機播放模式
    Swal.fire({
      theme: 'auto',
      title: "已退出隨機播放模式",
      icon: "info"
    });

    resetPlaylist();
    shuffleButton.innerHTML = "<i class=\"bi bi-shuffle\"></i><span class=\"dock-label\">啟動隨機播放</span>";
    isShuffleMode = false;
  }

});

// 開始隨機播放
function shufflePlaylist() {
  // 停止播放並清空路徑
  audioPlayer.src = "";

  // 備份現在的播放清單，以便稍後還原
  if (originalPlaylist.length === 0) {
    originalPlaylist = playlist;
  }

  playlist = playlist.slice().sort(() => Math.random() - 0.5);
  playlistElement.innerHTML = "";
  renderPlaylist()
} // shufflePlaylist()

// 結束隨機播放
function resetPlaylist() {
  if (originalPlaylist.length > 0) {
    audioPlayer.src = "";
    mainPlayerControl.innerHTML = "<i class=\"bi bi-play-fill\"></i><span class=\"dock-label\" id=\"mainPlayer-label\">主音樂未播放</span>";
    playlistElement.innerHTML = "";
    playlist = originalPlaylist;
    renderPlaylist();

    // 清空儲存的原始清單，避免影響下次隨機播放
    originalPlaylist = [];
  }
}

// 主音樂控制按鈕
mainPlayerControl.addEventListener("click", async () => {
  try {
    if (!audioPlayer.src || !audioPlayer.currentSrc || audioPlayer.src === "") {
      if (!playlist.length) {
        Swal.fire({
          theme: 'auto',
          title: '請先加入曲目',
          text: '請使用「加入音樂」按鈕加入要播放的音樂',
          icon: 'info',
          footer: '加入曲目後，還可以設定每首歌要播放的區間與是否要淡入淡出'
        })
      } // if
      else {
        Swal.fire({
          theme: 'auto',
          title: '請直接點選要播放的曲目',
          text: '點選曲目名稱後，即可自動載入並開始播放曲目',
          icon: 'info',
          footer: '你還可以設定每首歌要播放的區間與是否要淡入淡出，以符合你的需求！'
        })
      } // else
    } // if
    else {
      if (audioPlayer.paused) {
        await audioPlayer.play();
      } // if
      else {
        await audioPlayer.pause();
      } // else
    } // else
  } catch (error) {
    if (!playlist.length) {
      Swal.fire({
        theme: 'auto',
        title: '請先加入曲目',
        text: '請使用「加入音樂」按鈕加入要播放的音樂',
        icon: 'info',
        footer: '加入曲目後，還可以設定每首歌要播放的區間與是否要淡入淡出'
      })
    } // if
    else {
      Swal.fire({
        theme: 'auto',
        title: '請直接點選要播放的曲目',
        text: '點選曲目名稱後，即可自動載入並開始播放曲目',
        icon: 'info',
        footer: '你還可以設定每首歌要播放的區間與是否要淡入淡出，以符合你的需求！'
      })
    } // else
  } // catch
});

// 間隔音效控制按鈕
intermissionPlayerControl.addEventListener("click", () => {
  if (!intermissionAudioPlayer.src || !intermissionAudioPlayer.currentSrc) {
    Swal.fire({
      theme: 'auto',
      title: '尚未選擇間隔音效',
      text: '要使用間隔音功能，請點選「加入間隔」按鈕加入間隔音效',
      icon: 'info',
      footer: '間隔音會自動在每首曲目切換之間播放，無須您手動操作'
    })
  } // if
  else {
    if (intermissionAudioPlayer.paused) {
      intermissionAudioPlayer.play();
      intermissionPlayerControl.innerHTML = "<i class=\"bi bi-pause-fill\"></i><span class=\"dock-label\" id=\"intermissionPlayer-label\">間隔音播放中</span>";
    } // if
    else {
      intermissionAudioPlayer.pause();
      intermissionPlayerControl.innerHTML = "<i class=\"bi bi-play-fill\"></i><span class=\"dock-label\" id=\"intermissionPlayer-label\">間隔音未播放</span>";
    } // else
  } // else
});

audioPlayer.addEventListener('timeupdate', () => {
  document.getElementById('mainPlayer-label').textContent = "主音樂（" + formatTime(audioPlayer.currentTime) + "/" + formatTime(audioPlayer.duration) + "）";
});

audioPlayer.addEventListener('playing', () => {
  mainPlayerControl.innerHTML = "<i class=\"bi bi-pause-fill\"></i><span class=\"dock-label\" id=\"mainPlayer-label\">主音樂播放中</span>";
})

audioPlayer.addEventListener('pause', () => {
  mainPlayerControl.innerHTML = "<i class=\"bi bi-play-fill\"></i><span class=\"dock-label\" id=\"mainPlayer-label\">主音樂未播放</span>";
})

ipcRenderer.on("merge-progress", (event, { step, progress }) => {
  document.getElementById('mergeProgress').innerHTML = "<span class=\"loading loading-spinner loading-sm\"></span> " + step + "（" + progress + "）";
});