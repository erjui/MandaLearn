// Dual Subtitle for YouTube - Content Script
// This script runs on YouTube pages and manages multiple subtitle displays

console.log('[Dual Subtitle] ✅ Content script loaded!', window.location.href);

class DualSubtitle {
    constructor() {
        this.subtitleTracks = {};
        this.container = null;
        this.videoElement = null;
        this.enabled = false;
        this.selectedLanguages = [];
        this.playerData = null;
        this.updateInterval = null;
        this.hideNativeCaptionsInterval = null;
        this.languageCodeMap = {'english': 'en',
                                'pinyin': 'zh-CN',
                                'chinese': 'zh-CN'};
        this.init();
    }
    
    log(...args) {
        console.log('[Dual Subtitle]', ...args);
    }
    
    error(...args) {
        console.error('[Dual Subtitle ERROR]', ...args);
    }

    init() {
        this.log('Initializing...');
        
        // Inject script to access page context
        this.injectPageScript();
        
        // Listen for messages from injected script
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            
            if (event.data.type === 'YT_PLAYER_DATA') {
                this.log('Received player data from injected script');
                this.playerData = event.data.data;
                this.log('Player data:', {videoId: this.playerData?.videoDetails?.videoId,
                                          hasCaptions: !!this.playerData?.captions});
                
                // If we're waiting for player data, fetch subtitles now
                if (this.enabled && this.videoElement) {
                    this.fetchSubtitles();
                }
            }
            
            // NEW: Receive intercepted subtitle data
            if (event.data.type === 'YT_SUBTITLE_DATA') {
                this.log(`📥 Received intercepted ${event.data.lang} subtitles (${event.data.data.length} bytes)`);
                this.handleInterceptedSubtitles(event.data.lang, event.data.data);
            }
        });
        
        // Load user preferences
        chrome.storage.sync.get(['enabled', 'selectedLanguages'], (result) => {
            this.enabled = result.enabled !== false;
            this.selectedLanguages = result.selectedLanguages || [];
            this.log('Loaded preferences:', {enabled: this.enabled,
                                            languages: this.selectedLanguages,
                                            count: this.selectedLanguages.length});
            
            if (this.selectedLanguages.length === 0) {
                this.log('⚠️ WARNING: No languages selected! Please select languages in popup.');
            }
            
            if (this.enabled) {
                this.setup();
            }
        });

        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'toggle') {
                this.enabled = request.enabled;
                this.log('Toggle:', this.enabled);
                if (this.enabled) {
                    this.setup();
                } else {
                    this.cleanup();
                }
            } else if (request.action === 'updateLanguages') {
                this.selectedLanguages = request.languages;
                this.log('🔄 Updated languages from popup:', this.selectedLanguages, 'count:', this.selectedLanguages.length);
                
                if (this.selectedLanguages.length === 0) {
                    this.log('⚠️ All languages deselected - clearing subtitles');
                    // Recreate container with test message
                    if (this.container && this.enabled) {
                        this.createSubtitleContainer();
                    }
                } else {
                    this.log('Refreshing subtitles with new language selection...');
                    // Recreate container with loading messages
                    if (this.container && this.enabled) {
                        this.createSubtitleContainer();
                    }
                    this.refreshSubtitles();
                }
            }
            return true;
        });
    }

    injectPageScript() {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inject.js');
        script.onload = function() {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    }

    setup() {
        if (!this.enabled) {
            this.log('Setup called but extension is disabled');
            return;
        }
        
        this.log('Setup starting...');
        // Wait for video element to be available
        let attempts = 0;
        const checkVideo = setInterval(() => {
            const player = document.querySelector('.html5-video-player');
            this.videoElement = document.querySelector('video');
            
            this.log(`Attempt ${attempts + 1}: player=${!!player}, video=${!!this.videoElement}`);
            
            if (this.videoElement && player) {
                clearInterval(checkVideo);
                this.log('Video player found! Creating container...');
                this.createSubtitleContainer();
                this.setupObservers();
                this.fetchSubtitles();
            }
            
            if (++attempts > 20) { // 10 seconds max
                clearInterval(checkVideo);
                this.error('Timeout waiting for video player');
            }
        }, 500);
    }

    createSubtitleContainer() {
        this.log('Creating subtitle container...');
        
        // Remove existing container if present
        const existing = document.getElementById('dual-subtitle-container');
        if (existing) {
            this.log('Removing existing container');
            existing.remove();
        }

        // Create container for multiple subtitles
        this.container = document.createElement('div');
        this.container.id = 'dual-subtitle-container';
        this.container.className = 'dual-subtitle-container';

        // Create three subtitle divs (one for each language)
        for (let i = 0; i < 3; i++) {
            const subtitleDiv = document.createElement('div');
            subtitleDiv.className = `dual-subtitle dual-subtitle-${i}`;
            subtitleDiv.id = `dual-subtitle-${i}`;
            this.container.appendChild(subtitleDiv);
        }

        // Insert into video container
        const videoContainer = document.querySelector('.html5-video-player');
        if (videoContainer) {
            videoContainer.appendChild(this.container);
            this.log('Container appended to video player');
            this.log('Container rect:', this.container.getBoundingClientRect());
        } else {
            this.error('Video container not found!');
        }
        
        // Hide YouTube's native captions
        this.hideNativeCaptions();
    }
    
    hideNativeCaptions() {
        const nativeCaptions = document.querySelector('.ytp-caption-window-container');
        if (nativeCaptions) {
            nativeCaptions.style.display = 'none';
            this.log('Hidden YouTube native captions');
        } else {
            this.log('Native caption container not found (may not be enabled)');
        }
        
        // Keep hiding them (YouTube may re-show)
        if (this.hideNativeCaptionsInterval) {
            clearInterval(this.hideNativeCaptionsInterval);
        }
        this.hideNativeCaptionsInterval = setInterval(() => {
            const captions = document.querySelector('.ytp-caption-window-container');
            if (captions && captions.style.display !== 'none') {
                captions.style.display = 'none';
            }
        }, 1000);
    }
    
    showNativeCaptions() {
        const nativeCaptions = document.querySelector('.ytp-caption-window-container');
        if (nativeCaptions) {
            nativeCaptions.style.display = '';
            this.log('Restored YouTube native captions');
        }
    }

    setupObservers() {
        // Observe URL changes (YouTube is a SPA)
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                this.onNavigate();
            }
        }).observe(document, {subtree: true,
                               childList: true});

        // Start subtitle update interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.updateInterval = setInterval(() => {
            this.updateSubtitleDisplay();
        }, 100);
    }

    getVideoId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('v');
    }

    onNavigate() {
        this.log('Page navigated, reinitializing...');
        this.subtitleTracks = {};
        this.playerData = null;
        this.videoElement = document.querySelector('video');
        this.fetchSubtitles();
    }

    async fetchSubtitles() {
        try {
            // Get video ID from URL
            const videoId = this.getVideoId();
            
            if (!videoId) {
                this.log('No video ID in URL');
                return;
            }

            this.log('Fetching subtitles for video:', videoId);
            this.log('Current selected languages:', this.selectedLanguages);
            
            if (this.selectedLanguages.length === 0) {
                this.log('⚠️ No languages selected - skipping subtitle fetch');
                this.log('Please select languages in the popup (click the extension icon)');
                return;
            }

            // Extract player data from page if not already available
            if (!this.playerData) {
                await this.extractPlayerData();
            }
            
            if (!this.playerData || !this.playerData.captions) {
                this.log('No caption data found, waiting for player data...');
                // Wait a bit and try again (player data might come from injected script)
                setTimeout(() => {
                    if (this.playerData && this.playerData.captions) {
                        this.log('Player data now available, retrying...');
                        this.fetchSubtitles();
                    } else {
                        this.error('Player data still not available after timeout');
                    }
                }, 1000);
                return;
            }

            // Get caption tracks
            const captionTracks = this.playerData.captions.playerCaptionsTracklistRenderer?.captionTracks;
            
            if (!captionTracks || captionTracks.length === 0) {
                this.log('No caption tracks available for this video');
                return;
            }

            this.log('Found caption tracks:', captionTracks.map(t => ({lang: t.languageCode,
                                                                       name: t.name?.simpleText})));
            this.log('First track full object:', captionTracks[0]);

            // Fetch subtitles for selected languages
            await this.loadSubtitleTracks(captionTracks);
            
        } catch (error) {
            this.error('Error fetching subtitles:', error);
        }
    }

    async extractPlayerData() {
        // First try the window object (most reliable)
        if (window.ytInitialPlayerResponse) {
            this.playerData = window.ytInitialPlayerResponse;
            this.log('Player data from window object');
            return;
        }

        // Try to extract ytInitialPlayerResponse from page scripts
        const scripts = document.querySelectorAll('script');
        this.log(`Searching through ${scripts.length} script tags...`);
        
        for (const script of scripts) {
            const content = script.textContent;
            if (content.includes('ytInitialPlayerResponse')) {
                try {
                    // Use a more robust regex to capture the JSON
                    let startIdx = content.indexOf('ytInitialPlayerResponse');
                    if (startIdx === -1) continue;
                    
                    startIdx = content.indexOf('{', startIdx);
                    if (startIdx === -1) continue;
                    
                    // Find the matching closing brace
                    let braceCount = 0;
                    let endIdx = startIdx;
                    
                    for (let i = startIdx; i < content.length; i++) {
                        if (content[i] === '{') braceCount++;
                        if (content[i] === '}') braceCount--;
                        
                        if (braceCount === 0) {
                            endIdx = i + 1;
                            break;
                        }
                    }
                    
                    const jsonStr = content.substring(startIdx, endIdx);
                    this.playerData = JSON.parse(jsonStr);
                    this.log('Player data extracted from script tag');
                    return;
                } catch (e) {
                    this.error('Failed to parse player data from script:', e);
                    continue;
                }
            }
        }
        
        this.error('Could not extract player data');
    }

    async enableYouTubeCaptions() {
        this.log('🔧 Ensuring YouTube captions are ready...');
        
        const ccButton = document.querySelector('.ytp-subtitles-button');
        
        if (!ccButton) {
            this.log('⚠️ CC button not found');
            return false;
        }
        
        const isEnabled = ccButton.getAttribute('aria-pressed') === 'true';
        this.log(`CC button found, currently ${isEnabled ? 'enabled' : 'disabled'}`);
        
        // Always ensure captions are enabled
        // If already enabled, we still need to make sure we can intercept the fetches
        if (!isEnabled) {
            this.log('Enabling CC...');
            ccButton.click();
            await new Promise(resolve => setTimeout(resolve, 500));
        } else {
            this.log('CC already enabled - will switch through languages to trigger fetches');
        }
        
        return true;
    }

    async switchToLanguage(languageCode, languageName) {
        this.log(`🔄 Switching to ${languageName} (${languageCode})...`);
        
        try {
            // Click settings button
            const settingsButton = document.querySelector('.ytp-settings-button');
            if (!settingsButton) {
                this.error('Settings button not found');
                return false;
            }
            
            settingsButton.click();
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Find and click "Subtitles/CC" menu item
            const menuItems = document.querySelectorAll('.ytp-menuitem');
            let subtitlesMenuItem = null;
            
            for (const item of menuItems) {
                const label = item.querySelector('.ytp-menuitem-label');
                if (label && (label.textContent.includes('Subtitles') || 
                             label.textContent.includes('Subtítulos') ||
                             label.textContent.includes('字幕'))) {
                    subtitlesMenuItem = item;
                    break;
                }
            }
            
            if (!subtitlesMenuItem) {
                this.error('Subtitles menu item not found');
                // Close settings
                settingsButton.click();
                return false;
            }
            
            subtitlesMenuItem.click();
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Find and click the language option
            const languageItems = document.querySelectorAll('.ytp-menuitem');
            let targetLanguage = null;
            
            for (const item of languageItems) {
                const label = item.querySelector('.ytp-menuitem-label');
                if (label && label.textContent.includes(languageName)) {
                    targetLanguage = item;
                    break;
                }
            }
            
            if (!targetLanguage) {
                this.log(`⚠️ Language "${languageName}" not found in menu`);
                // Try to close menu by clicking settings again
                settingsButton.click();
                return false;
            }
            
            targetLanguage.click();
            this.log(`✓ Clicked ${languageName}`);
            
            // Wait for YouTube to fetch the subtitles
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Close settings menu
            const closeButton = document.querySelector('.ytp-settings-button');
            if (closeButton) {
                closeButton.click();
            }
            
            return true;
            
        } catch (error) {
            this.error('Error switching language:', error);
            return false;
        }
    }

    async loadSubtitleTracks(captionTracks) {
        this.log('🎯 Loading subtitle tracks by switching through languages');
        this.log('Requested languages:', this.selectedLanguages);
        this.log('Available tracks:', captionTracks.map(t => `${t.languageCode}:${t.name?.simpleText}`));
        
        // Clear any existing tracks
        this.subtitleTracks = {};
        
        // Enable YouTube's captions
        const captionsEnabled = await this.enableYouTubeCaptions();
        
        if (!captionsEnabled) {
            this.log('⚠️ Could not enable YouTube captions');
            return;
        }
        
        this.log('✅ YouTube captions ready');
        
        // Build a unique set of language codes to fetch (pinyin uses chinese track)
        const languagesToFetch = new Set();
        for (const lang of this.selectedLanguages) {
            if (lang === 'pinyin') {
                languagesToFetch.add('chinese');
            } else {
                languagesToFetch.add(lang);
            }
        }
        
        this.log('Languages to fetch:', Array.from(languagesToFetch));
        
        // Switch through each unique language to trigger subtitle fetches
        for (const lang of languagesToFetch) {
            const langCode = this.languageCodeMap[lang];
            
            // Find the track info
            const track = captionTracks.find(t => {
                const code = t.languageCode || t.lang;
                return code === langCode || 
                       code.startsWith(langCode.split('-')[0]) ||
                       (langCode.startsWith('zh') && code.startsWith('zh'));
            });
            
            if (!track) {
                this.log(`⚠️ No track found for ${lang} (${langCode})`);
                continue;
            }
            
            // Get the actual display name from YouTube (it's localized!)
            const displayName = track.name?.simpleText || track.name;
            
            this.log(`📍 Switching to ${lang}: ${displayName} (${track.languageCode || track.lang})`);
            
            // Switch to this language using the ACTUAL name from YouTube
            const switched = await this.switchToLanguage(langCode, displayName);
            
            if (switched) {
                // Wait longer for the fetch to complete and be intercepted
                await new Promise(resolve => setTimeout(resolve, 1200));
            } else {
                this.log(`⚠️ Failed to switch to ${lang}`);
            }
        }
        
        this.log('✅ Finished cycling through all languages');
        this.log('Intercepted tracks:', Object.keys(this.subtitleTracks));
        
        // Check if pinyin was requested - convert from Chinese
        if (this.selectedLanguages.includes('pinyin') && this.subtitleTracks['chinese']) {
            this.log('🔄 Converting Chinese subtitles to pinyin...');
            this.subtitleTracks['pinyin'] = await this.convertToPinyin(this.subtitleTracks['chinese']);
            this.log('✅ Converted Chinese to pinyin');
        }
        
        // If we still don't have some tracks, log warning
        for (const lang of this.selectedLanguages) {
            if (!this.subtitleTracks[lang]) {
                this.log(`⚠️ Missing subtitles for ${lang} - may not have been intercepted`);
            }
        }
    }

    async handleInterceptedSubtitles(lang, data) {
        this.log(`🔄 Processing intercepted ${lang} subtitles...`);
        
        try {
            // Detect format: JSON3 or XML
            let subtitles;
            if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
                // JSON format
                this.log('Detected JSON format');
                subtitles = this.parseJSON3Subtitles(data);
            } else {
                // XML format
                this.log('Detected XML format');
                subtitles = this.parseTimedText(data);
            }
            
            // Map lang to our language keys
            const langMap = {'en': 'english',
                           'zh-CN': 'chinese',
                           'zh-Hans': 'chinese',
                           'zh-TW': 'chinese',
                           'zh': 'chinese'};
            
            // Check if this language is in our selected languages
            for (const selectedLang of this.selectedLanguages) {
                const code = this.languageCodeMap[selectedLang];
                
                // Skip pinyin matching here - we'll convert from Chinese later if needed
                if (selectedLang === 'pinyin') {
                    continue;
                }
                
                // Check if intercepted lang matches what we need
                // Support multiple matching strategies
                const isMatch = lang === code || 
                              langMap[lang] === selectedLang || 
                              (code && code.startsWith('zh') && lang.startsWith('zh')) ||
                              (code === 'en' && lang === 'en') ||
                              (selectedLang === 'chinese' && lang.includes('zh'));
                
                if (isMatch) {
                    this.log(`✅ Matched intercepted ${lang} to ${selectedLang}`);
                    this.subtitleTracks[selectedLang] = subtitles;
                    this.log(`✓ Stored ${subtitles.length} subtitles for ${selectedLang}`);
                }
            }
        } catch (error) {
            this.error(`Error processing intercepted ${lang} subtitles:`, error);
        }
    }

    parseJSON3Subtitles(jsonText) {
        try {
            const data = JSON.parse(jsonText);
            const subtitles = [];
            
            // JSON3 format has events array with segments
            if (data.events) {
                for (const event of data.events) {
                    // Each event has a start time (tStartMs)
                    const startMs = event.tStartMs || 0;
                    const start = startMs / 1000; // Convert to seconds
                    
                    // Duration (dDurationMs)
                    const durationMs = event.dDurationMs || 2000;
                    const duration = durationMs / 1000;
                    
                    // Text is in segs (segments) array
                    if (event.segs) {
                        let text = '';
                        for (const seg of event.segs) {
                            if (seg.utf8) {
                                text += seg.utf8;
                            }
                        }
                        
                        text = text.replace(/\n/g, ' ').trim();
                        
                        if (text) {
                            subtitles.push({
                                start: start,
                                end: start + duration,
                                text: text
                            });
                        }
                    }
                }
            }
            
            this.log(`Parsed ${subtitles.length} subtitles from JSON3`);
            return subtitles;
        } catch (error) {
            this.error('Error parsing JSON3 subtitles:', error);
            return [];
        }
    }

    parseTimedText(xmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const textNodes = xmlDoc.querySelectorAll('text');
        
        const subtitles = [];
        
        textNodes.forEach(node => {
            const start = parseFloat(node.getAttribute('start'));
            const duration = parseFloat(node.getAttribute('dur') || '2');
            const text = node.textContent.replace(/\n/g, ' ').trim();
            
            if (text) {
                subtitles.push({start: start,
                               end: start + duration,
                               text: this.decodeHTMLEntities(text)});
            }
        });
        
        return subtitles;
    }

    decodeHTMLEntities(text) {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    }

    async convertToPinyin(subtitles) {
        // Convert Chinese characters to pinyin
        this.log('Converting Chinese subtitles to pinyin...');
        
        // Check if pinyin library is loaded (loaded via content_scripts in manifest)
        if (typeof window.pinyin === 'undefined' || !window.pinyin || !window.pinyin.pinyin) {
            this.error('⚠️ Pinyin library not loaded! Check manifest.json');
            return subtitles.map(sub => ({...sub,
                                          text: sub.text}));
        }
        
        // Get the pinyin function
        const pinyinFn = window.pinyin.pinyin || window.pinyin.default;
        
        if (!pinyinFn) {
            this.error('⚠️ Pinyin function not found in library');
            return subtitles.map(sub => ({...sub,
                                          text: sub.text}));
        }
        
        this.log('✅ Pinyin function ready, converting', subtitles.length, 'subtitles');
        
        // Convert each subtitle
        return subtitles.map(sub => {
            try {
                // Use pinyin library to convert Chinese to pinyin with tones
                const pinyinResult = pinyinFn(sub.text, {
                    style: pinyinFn.STYLE_TONE,
                    heteronym: false
                });
                
                // Join the pinyin array (each character becomes a syllable)
                const pinyinText = pinyinResult.map(item => Array.isArray(item) ? item[0] : item).join(' ');
                
                return {...sub,
                        text: pinyinText};
            } catch (error) {
                this.error('Error converting to pinyin:', error, sub.text);
                return {...sub,
                        text: sub.text};
            }
        });
    }

    updateSubtitleDisplay() {
        if (!this.container || !this.videoElement) return;

        const currentTime = this.videoElement.currentTime;

        // Update each subtitle line based on selected languages
        this.selectedLanguages.forEach((lang, index) => {
            const subtitleDiv = document.getElementById(`dual-subtitle-${index}`);
            if (!subtitleDiv) return;

            if (this.subtitleTracks[lang] && this.subtitleTracks[lang].length > 0) {
                const subtitle = this.findSubtitleAtTime(this.subtitleTracks[lang], currentTime);
                if (subtitle) {
                    subtitleDiv.textContent = subtitle.text;
                    subtitleDiv.style.display = 'block';
                } else {
                    // No subtitle at current time (gap between subtitles)
                    subtitleDiv.textContent = '';
                    subtitleDiv.style.display = 'none';
                }
            } else {
                // Track doesn't exist or is loading
                subtitleDiv.textContent = '';
                subtitleDiv.style.display = 'none';
            }
        });
        
        // Hide unused subtitle divs
        for (let i = this.selectedLanguages.length; i < 3; i++) {
            const subtitleDiv = document.getElementById(`dual-subtitle-${i}`);
            if (subtitleDiv) {
                subtitleDiv.textContent = '';
                subtitleDiv.style.display = 'none';
            }
        }
    }

    findSubtitleAtTime(subtitles, time) {
        // Find subtitle that matches current time
        if (!subtitles || !Array.isArray(subtitles)) {
            return null;
        }

        for (const subtitle of subtitles) {
            if (time >= subtitle.start && time <= subtitle.end) {
                return subtitle;
            }
        }
        return null; // No subtitle at this time
    }

    refreshSubtitles() {
        this.log('Refreshing subtitles - clearing existing tracks');
        this.subtitleTracks = {};
        this.log('Selected languages for refresh:', this.selectedLanguages);
        this.fetchSubtitles();
    }

    cleanup() {
        this.log('Cleaning up extension...');
        
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.hideNativeCaptionsInterval) {
            clearInterval(this.hideNativeCaptionsInterval);
            this.hideNativeCaptionsInterval = null;
        }
        
        // Restore native captions
        this.showNativeCaptions();
        
        this.log('Extension cleaned up, native captions restored');
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new DualSubtitle();
    });
} else {
    new DualSubtitle();
}

