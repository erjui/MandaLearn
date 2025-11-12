// Popup script for Dual Subtitle extension

let selectedLanguages = [];
const MAX_LANGUAGES = 3;

// Load saved settings
chrome.storage.sync.get(['enabled', 'selectedLanguages'], (result) => {
    const enableToggle = document.getElementById('enableToggle');
    enableToggle.checked = result.enabled !== false;
    
    selectedLanguages = result.selectedLanguages || [];
    updateLanguageDisplay();
    updateStatus();
});

// Handle enable/disable toggle
document.getElementById('enableToggle').addEventListener('change', (e) => {
    const enabled = e.target.checked;
    
    chrome.storage.sync.set({ enabled }, () => {
        // Notify content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'toggle',
                    enabled: enabled
                }).catch(err => {
                    console.log('Could not send message to content script:', err);
                    // This is normal if not on a YouTube page or content script not loaded yet
                });
            }
        });
        
        updateStatus();
    });
});

// Handle language selection
document.querySelectorAll('.lang-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
        const lang = e.target.dataset.lang;
        
        if (e.target.checked) {
            // Add language if not at max
            if (selectedLanguages.length < MAX_LANGUAGES) {
                selectedLanguages.push(lang);
            } else {
                // Max languages reached
                e.target.checked = false;
                showNotification('Maximum 3 languages allowed');
                return;
            }
        } else {
            // Remove language
            selectedLanguages = selectedLanguages.filter(l => l !== lang);
        }
        
        // Save and update
        chrome.storage.sync.set({ selectedLanguages }, () => {
            // Notify content script
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'updateLanguages',
                        languages: selectedLanguages
                    }).catch(err => {
                        console.log('Could not send message to content script:', err);
                        // This is normal if not on a YouTube page or content script not loaded yet
                    });
                }
            });
        });
        
        updateLanguageDisplay();
    });
});

function updateLanguageDisplay() {
    // Update checkboxes and order indicators
    document.querySelectorAll('.lang-checkbox').forEach(checkbox => {
        const lang = checkbox.dataset.lang;
        const orderElement = document.getElementById(`order-${lang}`);
        
        if (selectedLanguages.includes(lang)) {
            checkbox.checked = true;
            const order = selectedLanguages.indexOf(lang) + 1;
            orderElement.textContent = `#${order}`;
        } else {
            checkbox.checked = false;
            orderElement.textContent = '';
        }
    });
}

function updateStatus() {
    const statusElement = document.getElementById('status');
    const enabled = document.getElementById('enableToggle').checked;
    
    if (enabled) {
        statusElement.className = 'status active';
        statusElement.textContent = '✓ Extension Active';
    } else {
        statusElement.className = 'status inactive';
        statusElement.textContent = '✗ Extension Disabled';
    }
}

function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: #f44336;
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 1000;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 2000);
}

