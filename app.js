// app.js - NikkuChat Core Logic (Cloud Firestore Version)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  deleteField
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig, APP_CONFIG } from "./firebase-config.js";

// ==========================================================================
// 1. App State & Global Variables
// ==========================================================================
let db;
let currentUser = localStorage.getItem("nikku_chat_user") || null;
let partnerUser = null;
let presenceCheckInterval = null;

// Media Recording variables
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingStartTime = null;

// Typing Indicator variables
let typingTimeout = null;
let isCurrentlyTyping = false;

// DOM Cache
const passcodeScreen = document.getElementById("passcodeScreen");
const passcodeForm = document.getElementById("passcodeForm");
const passcodeField = document.getElementById("passcodeField");
const passcodeCard = document.getElementById("passcodeCard");
const passcodeErrorMsg = document.getElementById("passcodeErrorMsg");

const userSelectorScreen = document.getElementById("userSelectorScreen");
const userSelectCards = document.querySelectorAll(".user-select-card");

const chatDashboard = document.getElementById("chatDashboard");
const logoutBtn = document.getElementById("logoutBtn");
const partnerAvatar = document.getElementById("partnerAvatar");
const partnerInitials = document.getElementById("partnerInitials");
const partnerPresenceDot = document.getElementById("partnerPresenceDot");
const partnerName = document.getElementById("partnerName");
const partnerStatusText = document.getElementById("partnerStatusText");
const relationshipDays = document.getElementById("relationshipDays");

const chatArea = document.getElementById("chatArea");
const messagesList = document.getElementById("messagesList");
const messageInput = document.getElementById("messageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const voiceRecordBtn = document.getElementById("voiceRecordBtn");

const chatImageInput = document.getElementById("chatImageInput");
const galleryUploadInput = document.getElementById("galleryUploadInput");
const galleryToggleBtn = document.getElementById("galleryToggleBtn");
const galleryDrawer = document.getElementById("galleryDrawer");
const galleryCloseBtn = document.getElementById("galleryCloseBtn");
const galleryGrid = document.getElementById("galleryGrid");
const galleryUploadProgress = document.getElementById("galleryUploadProgress");
const galleryProgressBarFill = document.getElementById("galleryProgressBarFill");
const galleryProgressText = document.getElementById("galleryProgressText");

const voiceRecordingOverlay = document.getElementById("voiceRecordingOverlay");
const recordingTimer = document.getElementById("recordingTimer");
const voiceCancelBtn = document.getElementById("voiceCancelBtn");
const voiceStopAndSendBtn = document.getElementById("voiceStopAndSendBtn");

const typingIndicatorWrapper = document.getElementById("typingIndicatorWrapper");
const typingIndicatorText = document.getElementById("typingIndicatorText");

const emojiPanelBtn = document.getElementById("emojiPanelBtn");
const emojiPicker = document.getElementById("emojiPicker");
const emojiPickerClose = document.getElementById("emojiPickerClose");
const emojiBtnItems = document.querySelectorAll(".emoji-btn-item");

const lightboxModal = document.getElementById("lightboxModal");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxCloseBtn = document.getElementById("lightboxCloseBtn");

// ==========================================================================
// 2. State Machine & Routing Transitions
// ==========================================================================
function initApp() {
  generateFloatingHearts();

  // Check if passcode has been verified previously
  const isPasscodeVerified = localStorage.getItem("nikku_chat_passcode_verified") === "true";

  if (!isPasscodeVerified) {
    showScreen("passcode");
  } else if (!currentUser) {
    showScreen("selector");
  } else {
    showScreen("chat");
    startChatApplication();
  }

  setupAuthEventListeners();
}

function showScreen(screen) {
  passcodeScreen.classList.add("hidden");
  userSelectorScreen.classList.add("hidden");
  chatDashboard.classList.add("hidden");

  if (screen === "passcode") {
    passcodeScreen.classList.remove("hidden");
    passcodeField.focus();
  } else if (screen === "selector") {
    userSelectorScreen.classList.remove("hidden");
  } else if (screen === "chat") {
    chatDashboard.classList.remove("hidden");
  }
}

function setupAuthEventListeners() {
  // Passcode submission
  passcodeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const entered = passcodeField.value.trim();

    if (entered === APP_CONFIG.PASSCODE) {
      localStorage.setItem("nikku_chat_passcode_verified", "true");
      passcodeErrorMsg.classList.remove("visible");
      showScreen("selector");
    } else {
      // Shake animation on error
      passcodeCard.classList.add("shake");
      passcodeErrorMsg.classList.add("visible");
      passcodeField.value = "";

      setTimeout(() => {
        passcodeCard.classList.remove("shake");
      }, 400);
    }
  });

  // User Profile Select Click
  userSelectCards.forEach(card => {
    card.addEventListener("click", () => {
      const selectedUser = card.getAttribute("data-user");
      currentUser = selectedUser;
      localStorage.setItem("nikku_chat_user", selectedUser);
      showScreen("chat");
      startChatApplication();
    });
  });

  // Log Out / Profile Reset Click
  logoutBtn.addEventListener("click", async () => {
    if (confirm("Are you sure you want to lock and log out of your profile?")) {
      // Disconnect status from Firestore immediately before logging out
      await updatePresenceStatus("offline");

      localStorage.removeItem("nikku_chat_user");
      localStorage.removeItem("nikku_chat_passcode_verified");
      currentUser = null;
      partnerUser = null;

      // Reload page to reset all memory variables cleanly
      window.location.reload();
    }
  });
}

// ==========================================================================
// 3. Core Chat Initialization (Firestore & Context Setup)
// ==========================================================================
function startChatApplication() {
  // Identify partner user
  partnerUser = currentUser === "Rahul" ? "Nikku" : "Rahul";

  // Initialize UI variables for user & partner
  partnerName.textContent = partnerUser;
  partnerInitials.textContent = partnerUser.charAt(0);

  // Set up anniversary relationship counter
  updateAnniversaryCounter();
  setInterval(updateAnniversaryCounter, 60000); // refresh every minute

  // Adjust avatar classes
  partnerAvatar.className = `user-avatar-small ${partnerUser.toLowerCase()}-bg`;

  // Initialize Firebase Firestore
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);

    // Trigger listeners & presence heartbeats
    setupFirestorePresence();
    setupTypingDetection();
    listenToMessages();
    listenToTypingIndicator();
    listenToGallery();
    setupChatControls();
  } catch (error) {
    console.error("Firebase Initialization Failed:", error);
    alert("Could not load Firestore. Check your settings in firebase-config.js.");
  }
}

// ==========================================================================
// 4. Firestore Presence Heartbeat System
// ==========================================================================
function setupFirestorePresence() {
  const myStatusDocRef = doc(db, "status", currentUser);

  // 1. Initial write to online
  updatePresenceStatus("online");

  // 2. Start heartbeat interval every 20 seconds
  setInterval(() => {
    updatePresenceStatus("online");
  }, 20000);

  // 3. Unload page event sets offline
  const setOffline = () => {
    // navigator.sendBeacon is usually best for sync-unload, but since this is pure Firestore SDK,
    // we perform a standard status write. Note: Heartbeat acts as a fallback if this fails.
    updatePresenceStatus("offline");
  };
  window.addEventListener("beforeunload", setOffline);
  window.addEventListener("pagehide", setOffline);

  // 4. Observer for partner presence status
  const partnerStatusDocRef = doc(db, "status", partnerUser);
  onSnapshot(partnerStatusDocRef, (snapshot) => {
    const data = snapshot.data();

    const recheckStatus = () => {
      if (!data) {
        partnerPresenceDot.classList.remove("online");
        partnerStatusText.textContent = "Offline";
        return;
      }

      const now = Date.now();
      const lastChangedTime = data.last_changed || now;
      const secondsDiff = Math.floor((now - lastChangedTime) / 1000);

      // If status is online and last update was within 45 seconds, partner is online
      if (data.state === "online" && secondsDiff < 45) {
        partnerPresenceDot.classList.add("online");
        partnerStatusText.textContent = "online";
      } else {
        partnerPresenceDot.classList.remove("online");
        partnerStatusText.textContent = getRelativeTime(lastChangedTime);
      }
    };

    recheckStatus();

    // Periodically recheck diff (makes offline status display accurately even without DB updates)
    if (presenceCheckInterval) clearInterval(presenceCheckInterval);
    presenceCheckInterval = setInterval(recheckStatus, 10000);
  });
}

function updatePresenceStatus(state) {
  if (db && currentUser) {
    const myStatusDocRef = doc(db, "status", currentUser);
    return setDoc(myStatusDocRef, {
      state: state,
      last_changed: Date.now()
    }, { merge: true }).catch(err => {
      console.warn("Presence write failed:", err);
    });
  }
}

// ==========================================================================
// 5. Typing Detection Logic
// ==========================================================================
function setupTypingDetection() {
  messageInput.addEventListener("input", () => {
    if (!isCurrentlyTyping && messageInput.value.trim().length > 0) {
      setTypingState(true);
    }

    // Clear typing animation timer
    clearTimeout(typingTimeout);

    // If user stops typing for 1.5s, update typing status in DB
    typingTimeout = setTimeout(() => {
      setTypingState(false);
    }, 1500);
  });
}

function setTypingState(typing) {
  isCurrentlyTyping = typing;
  if (db && currentUser) {
    const typingDocRef = doc(db, "typing", currentUser);
    setDoc(typingDocRef, { isTyping: typing });
  }
}

function listenToTypingIndicator() {
  const partnerTypingDocRef = doc(db, "typing", partnerUser);
  onSnapshot(partnerTypingDocRef, (snapshot) => {
    const data = snapshot.data();
    if (data && data.isTyping === true) {
      typingIndicatorText.textContent = `${partnerUser} is typing...`;
      typingIndicatorWrapper.classList.remove("hidden");
      autoScrollToBottom();
    } else {
      typingIndicatorWrapper.classList.add("hidden");
    }
  });
}

// ==========================================================================
// 6. Real-Time Messages Fetch & Custom Message UI Rendering
// ==========================================================================
function listenToMessages() {
  const messagesQuery = query(
    collection(db, "messages"),
    orderBy("timestamp", "asc"),
    limit(200)
  );

  onSnapshot(messagesQuery, (snapshot) => {
    // Empty existing container
    messagesList.innerHTML = "";

    if (snapshot.empty) {
      messagesList.innerHTML = `
        <div class="chat-loading">
          <i class="fa-solid fa-heart pulse"></i>
          <p>No messages yet. Send a heart to get started! 💖</p>
        </div>
      `;
      return;
    }

    let lastDateString = "";

    snapshot.forEach((docSnapshot) => {
      const msg = docSnapshot.data();
      const msgId = docSnapshot.id;
      const msgDate = new Date(msg.timestamp || Date.now());
      const dateString = msgDate.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // Inject date separators
      if (dateString !== lastDateString) {
        lastDateString = dateString;
        const separator = document.createElement("div");
        separator.className = "date-separator";
        separator.innerHTML = `<span class="date-badge">${formatDateHeader(msgDate)}</span>`;
        messagesList.appendChild(separator);
      }

      // Build message element
      const messageRow = document.createElement("div");
      const isSent = msg.sender === currentUser;
      messageRow.className = `message-row ${isSent ? 'sent' : 'received'}`;

      // Format Timestamp
      const formattedTime = msgDate.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      // Build message HTML contents
      let bodyHTML = "";
      if (msg.imageUrl) {
        bodyHTML = `
          <div class="message-image-wrapper" data-src="${msg.imageUrl}">
            <img src="${msg.imageUrl}" alt="Shared Image">
          </div>
        `;
      } else if (msg.audioUrl) {
        bodyHTML = `
          <div class="voice-player" data-audio-id="${msgId}">
            <button class="play-pause-btn" id="playBtn-${msgId}" title="Play Voice Note">
              <i class="fa-solid fa-play"></i>
            </button>
            <div class="voice-controls-right">
              <div class="voice-progress-container" id="progressContainer-${msgId}">
                <div class="voice-progress-bar" id="progressBar-${msgId}"></div>
              </div>
              <div class="voice-time-info">
                <span id="currentTime-${msgId}">0:00</span>
                <span id="duration-${msgId}">0:00</span>
              </div>
            </div>
            <audio id="audioElement-${msgId}" src="${msg.audioUrl}" preload="metadata"></audio>
          </div>
        `;
      } else {
        bodyHTML = `<div class="message-text">${escapeHTML(msg.text)}</div>`;
      }

      // Build Reaction badges HTML
      let reactionBadgesHTML = "";
      if (msg.reactions) {
        const reactionsArray = [];
        Object.keys(msg.reactions).forEach(user => {
          if (msg.reactions[user]) {
            reactionsArray.push(msg.reactions[user]);
          }
        });

        if (reactionsArray.length > 0) {
          reactionBadgesHTML = `
            <div class="reaction-badge-list">
              ${reactionsArray.map(emoji => `<span class="reaction-badge-item">${emoji}</span>`).join("")}
            </div>
          `;
        }
      }

      // Create reaction popover panel content
      const reactionPopoverHTML = `
        <div class="reaction-popover">
          <button class="reaction-pop-btn" data-emoji="❤️" data-msg-id="${msgId}">❤️</button>
          <button class="reaction-pop-btn" data-emoji="😂" data-msg-id="${msgId}">😂</button>
          <button class="reaction-pop-btn" data-emoji="😍" data-msg-id="${msgId}">😍</button>
          <button class="reaction-pop-btn" data-emoji="👍" data-msg-id="${msgId}">👍</button>
          <button class="reaction-pop-btn" data-emoji="😭" data-msg-id="${msgId}">😭</button>
        </div>
      `;

      const bubbleClass = msg.sender === "Rahul" ? "rahul-bubble" : "nikku-bubble";

      messageRow.innerHTML = `
        <div class="message-bubble-wrapper">
          ${reactionPopoverHTML}
          <div class="message-bubble ${bubbleClass}">
            ${bodyHTML}
            <div class="message-meta">
              <span>${formattedTime}</span>
              ${isSent ? '<i class="fa-solid fa-check-double" style="margin-left:2px; font-size:9px;"></i>' : ''}
            </div>
            ${reactionBadgesHTML}
          </div>
        </div>
      `;

      messagesList.appendChild(messageRow);
    });

    // Set up audio player hooks and reaction events
    setupAudioPlayersInChat();
    setupReactionListeners();
    setupImageClickZoom();

    autoScrollToBottom();
  });
}

function setupChatControls() {
  // Input heights auto-resize
  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = (messageInput.scrollHeight) + "px";

    // Toggle send vs record button visibility
    const textVal = messageInput.value.trim();
    if (textVal.length > 0) {
      sendMessageBtn.classList.remove("hidden");
      voiceRecordBtn.classList.add("hidden");
    } else {
      sendMessageBtn.classList.add("hidden");
      voiceRecordBtn.classList.remove("hidden");
    }
  });

  // Sending a message
  sendMessageBtn.addEventListener("click", sendTextMessage);

  // Enter key submits message, Shift+Enter adds new line
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  // Emoji Panel trigger buttons
  emojiPanelBtn.addEventListener("click", () => {
    emojiPicker.classList.toggle("hidden");
  });

  emojiPickerClose.addEventListener("click", () => {
    emojiPicker.classList.add("hidden");
  });

  emojiBtnItems.forEach(btn => {
    btn.addEventListener("click", () => {
      const emoji = btn.getAttribute("data-emoji");
      messageInput.value += emoji;
      messageInput.focus();

      // Manually trigger input event for auto-resize and button toggle
      messageInput.dispatchEvent(new Event("input"));
      emojiPicker.classList.add("hidden");
    });
  });

  // Chat attachment file trigger (compress & base64)
  chatImageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      processAndSendImage(file, false);
      // Reset input
      chatImageInput.value = "";
    }
  });

  // Shared Gallery Upload zone (compress & base64)
  galleryUploadInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      processAndSendImage(file, true);
      galleryUploadInput.value = "";
    }
  });

  // Gallery slider toggles
  galleryToggleBtn.addEventListener("click", () => {
    galleryDrawer.classList.toggle("open");
  });

  galleryCloseBtn.addEventListener("click", () => {
    galleryDrawer.classList.remove("open");
  });

  // Lightbox Close trigger
  lightboxCloseBtn.addEventListener("click", () => {
    lightboxModal.classList.add("hidden");
    lightboxImg.src = "";
  });
  lightboxModal.addEventListener("click", (e) => {
    if (e.target === lightboxModal) {
      lightboxModal.classList.add("hidden");
      lightboxImg.src = "";
    }
  });

  // Setup Voice Notes logic
  setupVoiceRecorder();
}

// ==========================================================================
// 7. Message Dispatchers & Base64 Compilers
// ==========================================================================
function sendTextMessage() {
  const text = messageInput.value.trim();
  if (text.length === 0) return;

  // Reset fields
  messageInput.value = "";
  messageInput.style.height = "auto";
  sendMessageBtn.classList.add("hidden");
  voiceRecordBtn.classList.remove("hidden");

  setTypingState(false);
  clearTimeout(typingTimeout);

  // Send message write to Firestore
  addDoc(collection(db, "messages"), {
    sender: currentUser,
    text: text,
    timestamp: Date.now()
  }).catch(err => {
    console.error("Message send failed:", err);
  });
}

// Browser-side Image Compressing Utility
function compressImage(file, maxDimension = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        // Downscale bounds
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Extract Base64 JPEG string
        const base64Data = canvas.toDataURL("image/jpeg", quality);
        resolve(base64Data);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

async function processAndSendImage(file, isGalleryDrawerUpload) {
  if (!db) return;

  // Show progress indicator
  galleryUploadProgress.classList.remove("hidden");
  galleryProgressBarFill.style.width = "40%";
  galleryProgressText.textContent = "Compressing Photo...";

  try {
    const compressedBase64 = await compressImage(file, 800, 0.7);

    galleryProgressBarFill.style.width = "80%";
    galleryProgressText.textContent = "Saving to database...";

    // Save compressed base64 to messages
    const messagePromise = addDoc(collection(db, "messages"), {
      sender: currentUser,
      imageUrl: compressedBase64,
      timestamp: Date.now()
    });

    // Also record under gallery node for catalog grid
    const galleryPromise = addDoc(collection(db, "gallery"), {
      url: compressedBase64,
      uploader: currentUser,
      timestamp: Date.now()
    });

    await Promise.all([messagePromise, galleryPromise]);

    galleryUploadProgress.classList.add("hidden");
    if (isGalleryDrawerUpload) {
      alert("Photo compressed and added to gallery! 📸💖");
    }
  } catch (error) {
    console.error("Image processing/upload failed:", error);
    alert("Could not process and upload image.");
    galleryUploadProgress.classList.add("hidden");
  }
}

// Convert audio blob to Base64 data string
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ==========================================================================
// 8. Custom Audio Player Bindings
// ==========================================================================
function setupAudioPlayersInChat() {
  const players = messagesList.querySelectorAll(".voice-player");
  players.forEach(player => {
    const msgId = player.getAttribute("data-audio-id");
    const audio = player.querySelector(`#audioElement-${msgId}`);
    const btn = player.querySelector(`#playBtn-${msgId}`);
    const icon = btn.querySelector("i");
    const progressContainer = player.querySelector(`#progressContainer-${msgId}`);
    const progressBar = player.querySelector(`#progressBar-${msgId}`);
    const curTimeTxt = player.querySelector(`#currentTime-${msgId}`);
    const durTxt = player.querySelector(`#duration-${msgId}`);

    // Format Seconds to MM:SS
    const formatTime = (secs) => {
      if (isNaN(secs) || !isFinite(secs)) return "0:00";
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60).toString().padStart(2, "0");
      return `${m}:${s}`;
    };

    // Set duration meta
    audio.addEventListener("loadedmetadata", () => {
      durTxt.textContent = formatTime(audio.duration);
    });

    // Fallback if metadata already loaded
    if (audio.duration) {
      durTxt.textContent = formatTime(audio.duration);
    }

    // Play/Pause button
    btn.addEventListener("click", () => {
      // Pause all other media
      messagesList.querySelectorAll("audio").forEach(otherAudio => {
        if (otherAudio !== audio && !otherAudio.paused) {
          otherAudio.pause();
        }
      });

      if (audio.paused) {
        audio.play().catch(err => console.log("Play interrupted:", err));
      } else {
        audio.pause();
      }
    });

    // Track playing state animations
    audio.addEventListener("play", () => {
      icon.className = "fa-solid fa-pause";
      // Clear other play buttons
      messagesList.querySelectorAll(".voice-player").forEach(otherPlayer => {
        if (otherPlayer !== player) {
          const otherIcon = otherPlayer.querySelector(".play-pause-btn i");
          if (otherIcon) otherIcon.className = "fa-solid fa-play";
        }
      });
    });

    audio.addEventListener("pause", () => {
      icon.className = "fa-solid fa-play";
    });

    audio.addEventListener("ended", () => {
      icon.className = "fa-solid fa-play";
      progressBar.style.width = "0%";
      curTimeTxt.textContent = "0:00";
    });

    // Progress fill update
    audio.addEventListener("timeupdate", () => {
      if (audio.duration) {
        const pct = (audio.currentTime / audio.duration) * 100;
        progressBar.style.width = `${pct}%`;
        curTimeTxt.textContent = formatTime(audio.currentTime);
      }
    });

    // Seeking timeline
    progressContainer.addEventListener("click", (e) => {
      const rect = progressContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = clickX / rect.width;
      if (audio.duration) {
        audio.currentTime = pct * audio.duration;
      }
    });
  });
}

// ==========================================================================
// 9. Emoji Reactions Actions (Firestore Map Updates)
// ==========================================================================
function setupReactionListeners() {
  const popoverBtns = messagesList.querySelectorAll(".reaction-pop-btn");
  popoverBtns.forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const emoji = btn.getAttribute("data-emoji");
      const msgId = btn.getAttribute("data-msg-id");

      const messageDocRef = doc(db, "messages", msgId);

      // Perform a transaction or direct update of the reactions object
      const wrapper = btn.closest(".message-bubble-wrapper");
      if (wrapper) wrapper.classList.remove("popover-open");

      // Toggle reaction logic: if it's already this emoji, delete the field.
      // We can query the element local status or directly read and update.
      // To keep it simple, we read the DOM or just fetch document.
      // We'll read the DOM: does the badge list contain the emoji and are we the one who placed it?
      // Since it's easier, we'll read the document structure in Firestore or toggle.
      // Let's toggle by checking if the reactions badge matches.
      // Alternatively, we can check the dataset reactions.
      // A quick toggle update via updateDoc:
      const bubble = btn.closest(".message-bubble");
      const badgeList = bubble ? bubble.querySelector(".reaction-badge-list") : null;
      let hasMyReactionAlready = false;

      // Determine if currentUser already reacted with this emoji by checking if it already exists.
      // To keep it fully atomic and clean, we write a simple update:
      // If we want it strictly atomic we fetch doc data.
      try {
        const reactionsObj = {};
        reactionsObj[`reactions.${currentUser}`] = emoji;

        // Simple toggle state (we can read the active badge DOM text contents or check Firestore data)
        // Let's do a simple updateDoc. If it was clicked, we set it.
        // We can check if the current user clicked it. To toggle:
        // We can just verify if the user's specific emoji is active.
        // Let's read the current document from Firestore first to verify:
        // (This is standard and safe)
        const checkRef = doc(db, "messages", msgId);
        onSnapshot(checkRef, (snap) => {
          const mData = snap.data();
          if (mData && mData.reactions && mData.reactions[currentUser] === emoji) {
            // Remove emoji
            updateDoc(messageDocRef, {
              [`reactions.${currentUser}`]: deleteField()
            });
          } else {
            // Apply emoji
            updateDoc(messageDocRef, {
              [`reactions.${currentUser}`]: emoji
            });
          }
        }, { onlyOnce: true });

      } catch (err) {
        console.error("Failed to toggle reaction:", err);
      }
    });
  });

  // Mobile touch hold toggle popover helper
  const bubbleWrappers = messagesList.querySelectorAll(".message-bubble-wrapper");
  bubbleWrappers.forEach(wrap => {
    // Handle tap toggles on mobile
    wrap.addEventListener("click", (e) => {
      // Toggle only if clicked on bubble itself, and ignore triggers on controls/images
      if (e.target.closest(".play-pause-btn") || e.target.closest(".voice-progress-container") || e.target.closest(".message-image-wrapper")) {
        return;
      }

      // Clear other open popovers
      bubbleWrappers.forEach(otherWrap => {
        if (otherWrap !== wrap) otherWrap.classList.remove("popover-open");
      });

      wrap.classList.toggle("popover-open");
    });

    // Close popover when clicking anywhere else
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) {
        wrap.classList.remove("popover-open");
      }
    });
  });
}

// ==========================================================================
// 10. Voice Recorder (Audio Capturing & Base64 Compiles)
// ==========================================================================
function setupVoiceRecorder() {
  voiceRecordBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Voice recording is not supported in this browser. Please use a modern browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startRecording(stream);
    } catch (err) {
      console.error("Microphone Access Blocked:", err);
      alert("Microphone permission was denied. Please allow microphone access to record voice notes.");
    }
  });

  voiceCancelBtn.addEventListener("click", cancelRecording);
  voiceStopAndSendBtn.addEventListener("click", stopAndSendRecording);
}

function startRecording(stream) {
  // Set UI State
  voiceRecordingOverlay.classList.remove("hidden");
  messageInput.classList.add("hidden");
  emojiPanelBtn.classList.add("hidden");

  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener("stop", () => {
    stream.getTracks().forEach(track => track.stop());
  });

  mediaRecorder.start();
  recordingStartTime = Date.now();

  updateRecordingTimer();
  recordingInterval = setInterval(updateRecordingTimer, 1000);
}

function updateRecordingTimer() {
  const elapsed = Date.now() - recordingStartTime;
  const secsTotal = Math.floor(elapsed / 1000);
  const m = Math.floor(secsTotal / 60);
  const s = Math.floor(secsTotal % 60).toString().padStart(2, "0");
  recordingTimer.textContent = `${m}:${s}`;
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  clearInterval(recordingInterval);
  voiceRecordingOverlay.classList.add("hidden");
  messageInput.classList.remove("hidden");
  emojiPanelBtn.classList.remove("hidden");

  audioChunks = [];
  mediaRecorder = null;
}

function stopAndSendRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  mediaRecorder.addEventListener("stop", async () => {
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    try {
      const base64Audio = await blobToBase64(audioBlob);
      // Save entry to messages
      addDoc(collection(db, "messages"), {
        sender: currentUser,
        audioUrl: base64Audio,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("Audio recording conversion failed:", err);
      alert("Could not compile and send voice note.");
    }
  });

  mediaRecorder.stop();

  // Reset recording timers and widgets
  clearInterval(recordingInterval);
  voiceRecordingOverlay.classList.add("hidden");
  messageInput.classList.remove("hidden");
  emojiPanelBtn.classList.remove("hidden");
}

// ==========================================================================
// 11. Image Zoom Overlay Lightbox
// ==========================================================================
function setupImageClickZoom() {
  const imgWrappers = messagesList.querySelectorAll(".message-image-wrapper");
  imgWrappers.forEach(wrap => {
    wrap.addEventListener("click", () => {
      const src = wrap.getAttribute("data-src");
      lightboxImg.src = src;
      lightboxModal.classList.remove("hidden");
    });
  });
}

// ==========================================================================
// 12. Shared Photo Gallery Sync
// ==========================================================================
function listenToGallery() {
  const galleryQuery = query(
    collection(db, "gallery"),
    orderBy("timestamp", "desc"),
    limit(100)
  );

  onSnapshot(galleryQuery, (snapshot) => {
    galleryGrid.innerHTML = "";

    if (snapshot.empty) {
      galleryGrid.innerHTML = `<p class="empty-gallery-msg">No shared photos yet. Send some in chat or upload here! 📸</p>`;
      return;
    }

    snapshot.forEach((docSnapshot) => {
      const item = docSnapshot.data();
      const card = document.createElement("div");
      card.className = "gallery-item";
      card.innerHTML = `<img src="${item.url}" alt="Gallery upload by ${item.uploader}" loading="lazy">`;

      // Zoom photo in lightbox on click
      card.addEventListener("click", () => {
        lightboxImg.src = item.url;
        lightboxModal.classList.remove("hidden");
      });

      galleryGrid.appendChild(card);
    });
  });
}

// ==========================================================================
// 13. Auxiliary Helper & Decorative Functions
// ==========================================================================
function updateAnniversaryCounter() {
  const startStr = APP_CONFIG.RELATIONSHIP_START_DATE;
  const startDate = new Date(startStr);
  const now = new Date();

  // Calculate day difference
  const diffTime = now - startDate;
  const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

  relationshipDays.textContent = diffDays;
}

function getRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (secs < 60) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins}m ago`;
  if (hours < 24) return `Last seen ${hours}h ago`;
  return `Last seen ${days}d ago`;
}

function formatDateHeader(dateObj) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (dateObj.toDateString() === now.toDateString()) {
    return "Today";
  } else if (dateObj.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  } else {
    return dateObj.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
}

function autoScrollToBottom() {
  chatArea.scrollTo({
    top: chatArea.scrollHeight,
    behavior: "smooth"
  });
}

function generateFloatingHearts() {
  const container = document.getElementById("heartBgContainer");
  if (!container) return;

  const heartSymbols = ["❤️", "💖", "💕", "💘", "💜"];

  setInterval(() => {
    if (container.children.length > 25) {
      container.removeChild(container.firstChild);
    }

    const heart = document.createElement("div");
    heart.className = "floating-heart";
    heart.textContent = heartSymbols[Math.floor(Math.random() * heartSymbols.length)];

    const size = Math.random() * 1.5 + 0.8;
    const left = Math.random() * 100;
    const duration = Math.random() * 10 + 8;
    const delay = Math.random() * 2;

    heart.style.left = `${left}%`;
    heart.style.fontSize = `${size}rem`;
    heart.style.animationDuration = `${duration}s`;
    heart.style.animationDelay = `${delay}s`;

    container.appendChild(heart);
  }, 1000);
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Auto-initialize application
document.addEventListener("DOMContentLoaded", initApp);
