// Background service worker for Dual Subtitle extension

// Initialize default settings on installation
chrome.runtime.onInstalled.addListener(() => {
    // Set default settings
    chrome.storage.sync.set({
        enabled: true,
        selectedLanguages: ['english', 'pinyin', 'chinese']
    });
    
    console.log('Dual Subtitle extension installed');
    
    // Create context menu for quick access
    try {
        chrome.contextMenus.create({
            id: 'toggleDualSubtitle',
            title: 'Toggle Dual Subtitle',
            contexts: ['page'],
            documentUrlPatterns: ['https://www.youtube.com/*']
        });
    } catch (error) {
        console.log('Context menu creation failed:', error);
    }
});

// Handle messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSettings') {
        chrome.storage.sync.get(['enabled', 'selectedLanguages'], (result) => {
            sendResponse(result);
        });
        return true;
    }
});

// Handle context menu clicks
try {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === 'toggleDualSubtitle') {
            chrome.storage.sync.get(['enabled'], (result) => {
                const newState = !result.enabled;
                chrome.storage.sync.set({ enabled: newState });
                
                // Notify the content script
                if (tab && tab.id) {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'toggle',
                        enabled: newState
                    }).catch(err => console.log('Message send failed:', err));
                }
            });
        }
    });
} catch (error) {
    console.log('Context menu listener setup failed:', error);
}

