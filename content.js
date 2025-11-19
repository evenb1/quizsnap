// Prevent multiple injections
if (typeof window.quizSnapLoaded === 'undefined') {
  window.quizSnapLoaded = true;

  // State management
  let state = {
    status: 'idle', // idle | scanning | ready | error
    lastAnswer: null,
    lastQuestion: null
  };

  // Gemini API Configuration
  const GEMINI_API_KEY = 'AIzaSyD6JxruDiw_bnY4mHnDJJRevYbhqc_piw8';
  const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  // UI Elements
  let floatingButton = null;
  let menu = null;
  let hoverTimeout = null;
  let answerPanel = null;

  // Initialize UI
  function initUI() {
    createFloatingButton();
    createMenu();
    setupKeyboardShortcut();
    setupGlobalClickHandler();
  }

  function createFloatingButton() {
    floatingButton = document.createElement('div');
    floatingButton.id = 'quizsnap-float';
    floatingButton.className = 'quizsnap-float quizsnap-idle';
    
    // Hover events
    floatingButton.addEventListener('mouseenter', () => {
      hoverTimeout = setTimeout(() => {
        showMenu();
      }, 200);
    });
    
    floatingButton.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimeout);
    });
    
    document.body.appendChild(floatingButton);
  }

  function createMenu() {
    menu = document.createElement('div');
    menu.id = 'quizsnap-menu';
    menu.className = 'quizsnap-menu quizsnap-hidden';
    
    menu.innerHTML = `
      <div class="quizsnap-menu-item" data-action="scan">
        <span class="icon">🔍</span>
        <span class="label">Scan</span>
      </div>
      <div class="quizsnap-menu-item quizsnap-requires-answer" data-action="answer">
        <span class="icon">💬</span>
        <span class="label">Answer</span>
      </div>
      <div class="quizsnap-menu-item quizsnap-requires-answer" data-action="copy">
        <span class="icon">📋</span>
        <span class="label">Copy</span>
      </div>
    `;
    
    // Menu hover to keep it open
    menu.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
    });
    
    menu.addEventListener('mouseleave', () => {
      hideMenu();
    });
    
    // Click handlers
    menu.querySelectorAll('.quizsnap-menu-item').forEach(item => {
      item.addEventListener('click', handleMenuClick);
    });
    
    document.body.appendChild(menu);
  }

  function setupGlobalClickHandler() {
    document.addEventListener('click', (e) => {
      // Close menu if clicking outside
      if (menu && !menu.classList.contains('quizsnap-hidden')) {
        if (!menu.contains(e.target) && !floatingButton.contains(e.target)) {
          hideMenu();
        }
      }
      
      // Close answer panel if clicking outside
      if (answerPanel && !answerPanel.classList.contains('quizsnap-hidden')) {
        if (!answerPanel.contains(e.target) && !floatingButton.contains(e.target) && !menu.contains(e.target)) {
          hideAnswerPanel();
        }
      }
    });
  }

  function showMenu() {
    menu.classList.remove('quizsnap-hidden');
    updateMenuItems();
  }

  function hideMenu() {
    menu.classList.add('quizsnap-hidden');
  }

  function updateMenuItems() {
    const requiresAnswer = menu.querySelectorAll('.quizsnap-requires-answer');
    if (state.status === 'ready') {
      requiresAnswer.forEach(item => item.classList.remove('quizsnap-disabled'));
    } else {
      requiresAnswer.forEach(item => item.classList.add('quizsnap-disabled'));
    }
  }

  function updateButtonState(status) {
    state.status = status;
    floatingButton.className = `quizsnap-float quizsnap-${status}`;
    updateMenuItems();
  }

  async function handleMenuClick(e) {
    const action = e.currentTarget.dataset.action;
    
    if (action === 'scan') {
      hideMenu();
      await handleScan();
    } else if (action === 'answer' && state.status === 'ready') {
      hideMenu();
      showAnswerPanel();
    } else if (action === 'copy' && state.status === 'ready') {
      hideMenu();
      copyToClipboard();
    }
  }

  async function handleScan() {
    updateButtonState('scanning');
    
    try {
      // Wait for Tesseract
      let attempts = 0;
      while (typeof Tesseract === 'undefined' && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      if (typeof Tesseract === 'undefined') {
        throw new Error('OCR library not loaded');
      }
      
      // Capture screenshot
      const response = await chrome.runtime.sendMessage({ action: 'captureScreen' });
      
      if (!response.success) {
        throw new Error('Failed to capture screen');
      }
      
      // OCR
      const { data: { text } } = await Tesseract.recognize(
        response.imageData,
        'eng',
        { logger: m => console.log(m) }
      );
      
      console.log('Extracted text:', text);
      
      if (!text || text.trim().length === 0) {
        throw new Error('No text found');
      }
      
      // Get answer from Gemini
      const result = await askGemini(text);
      
      // Store result
      state.lastQuestion = result.question;
      state.lastAnswer = result.answer;
      
      updateButtonState('ready');
      
    } catch (error) {
      console.error('Scan error:', error);
      updateButtonState('error');
      showToast('Scan failed: ' + error.message);
      
      // Reset to idle after 2 seconds
      setTimeout(() => {
        updateButtonState('idle');
      }, 2000);
    }
  }

  async function handleTextScan(selectedText) {
    updateButtonState('scanning');
    
    try {
      console.log('Selected text:', selectedText);
      
      if (!selectedText || selectedText.trim().length === 0) {
        throw new Error('No text selected');
      }
      
      // Get answer from Gemini directly (no OCR needed)
      const result = await askGemini(selectedText);
      
      // Store result
      state.lastQuestion = result.question;
      state.lastAnswer = result.answer;
      
      updateButtonState('ready');
      
    } catch (error) {
      console.error('Scan error:', error);
      updateButtonState('error');
      showToast('Scan failed: ' + error.message);
      
      // Reset to idle after 2 seconds
      setTimeout(() => {
        updateButtonState('idle');
      }, 2000);
    }
  }

  async function askGemini(extractedText) {
    const prompt = `You are a helpful quiz assistant. Analyze the following text which may contain a quiz question.

Text: """
${extractedText}
"""

Your task:
1. Identify the main question being asked
2. Provide a clear, concise answer
3. If it's multiple choice, indicate the correct option (A, B, C, D, etc.)
4. If it's a short answer question, provide a direct answer
5. if the question has marks, answer it based on the marks allocated
6. anwer the question based on the length of answer required
Respond in this EXACT format:
QUESTION: [the question text]
ANSWER: [the answer]

If you cannot identify a clear question, respond with:
QUESTION: No clear question found
ANSWER: Please try scanning again with a clearer view of the question`;

    const url = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates[0].content.parts[0].text;
    
    console.log('Gemini response:', aiResponse);
    
    // Parse response
    const questionMatch = aiResponse.match(/QUESTION:\s*(.+?)(?=\nANSWER:)/s);
    const answerMatch = aiResponse.match(/ANSWER:\s*(.+)/s);
    
    return {
      question: questionMatch ? questionMatch[1].trim() : 'Could not parse question',
      answer: answerMatch ? answerMatch[1].trim() : 'Could not parse answer'
    };
  }

  function showAnswerPanel() {
    if (answerPanel) answerPanel.remove();
    
    answerPanel = document.createElement('div');
    answerPanel.className = 'quizsnap-panel quizsnap-hidden';
    answerPanel.innerHTML = `
      <button class="quizsnap-panel-close">×</button>
      <div class="quizsnap-panel-section">
        <div class="quizsnap-panel-label">QUESTION</div>
        <div class="quizsnap-panel-text">${state.lastQuestion}</div>
      </div>
      <div class="quizsnap-panel-section">
        <div class="quizsnap-panel-label">ANSWER</div>
        <div class="quizsnap-panel-text quizsnap-answer-text">${state.lastAnswer}</div>
      </div>
      <button class="quizsnap-panel-copy">Copy Answer</button>
    `;
    
    document.body.appendChild(answerPanel);
    
    // Trigger animation
    setTimeout(() => answerPanel.classList.remove('quizsnap-hidden'), 10);
    
    answerPanel.querySelector('.quizsnap-panel-close').onclick = hideAnswerPanel;
    answerPanel.querySelector('.quizsnap-panel-copy').onclick = () => {
      copyToClipboard();
      hideAnswerPanel();
    };
  }

  function hideAnswerPanel() {
    if (answerPanel) {
      answerPanel.classList.add('quizsnap-hidden');
      setTimeout(() => answerPanel.remove(), 300);
    }
  }

  function copyToClipboard() {
    if (!state.lastAnswer) return;
    
    navigator.clipboard.writeText(state.lastAnswer).then(() => {
      showToast('Copied to clipboard!');
    }).catch(err => {
      console.error('Copy failed:', err);
      showToast('Copy failed');
    });
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'quizsnap-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('quizsnap-toast-show'), 10);
    setTimeout(() => {
      toast.classList.remove('quizsnap-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function setupKeyboardShortcut() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+Q or Cmd+Shift+Q
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Q') {
        e.preventDefault();
        handleScan();
      }
    });
  }

  // Message listener for background script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'scanQuestion') {
      handleScan();
    } else if (request.action === 'scanText') {
      handleTextScan(request.text);
    }
  });

  // Initialize
  initUI();
}