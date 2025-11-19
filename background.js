// Create context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "quizsnap-scan",
    title: "Scan with QuizSnap",
    contexts: ["selection"]
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "quizsnap-scan" && info.selectionText) {
    // Send selected text to content script
    chrome.tabs.sendMessage(tab.id, { 
      action: 'scanText',
      text: info.selectionText
    });
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  // Check if it's a chrome:// page
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    console.log('Cannot run on chrome:// pages');
    return;
  }
  
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'scanQuestion' });
  } catch (error) {
    console.log('Content script not loaded, injecting manually...');
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['tesseract.min.js', 'content.js']
      });
      
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });
      
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'scanQuestion' });
      }, 500);
    } catch (injectError) {
      console.error('Failed to inject scripts:', injectError);
    }
  }
});

// Handle screenshot requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureScreen') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      sendResponse({ success: true, imageData: dataUrl });
    });
    return true;
  }
});