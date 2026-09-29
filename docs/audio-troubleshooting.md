# Audio Capture Troubleshooting Guide

## Issue: Microphone and Speaker Audio Not Being Captured

### Quick Fix (Try This First)

1. **Open DevTools**: Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac)
2. **Go to Console tab**
3. **Run this command**:
   ```javascript
   localStorage.setItem('audioMode', 'both')
   ```
4. **Restart the capture** (Stop and Start again)

### Understanding Audio Modes

The app has three audio capture modes stored in `localStorage`:

- **`speaker_only`** (default): Captures only system audio (what plays through speakers)
- **`mic_only`**: Captures only microphone input
- **`both`**: Captures both microphone AND system audio ✅ **This is what you want**

### Detailed Troubleshooting Steps

#### Step 1: Check Current Audio Mode

Open DevTools Console and run:
```javascript
console.log('Current audio mode:', localStorage.getItem('audioMode'));
```

If it shows `null` or `speaker_only`, that's why your microphone isn't working!

#### Step 2: Set Audio Mode to "both"

```javascript
localStorage.setItem('audioMode', 'both')
```

#### Step 3: Verify Browser Permissions

The app needs two permissions:

1. **Display Capture Permission** (for screen + speaker audio)
   - You should see a dialog asking "Share your screen"
   - Make sure "Share audio" checkbox is CHECKED ✅

2. **Microphone Permission** (for mic input)
   - You should see a dialog asking "Use your microphone"
   - Click "Allow" ✅

**Test Microphone Access:**
```javascript
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('✓ Microphone works!', stream);
    stream.getTracks().forEach(track => track.stop()); // Cleanup
  })
  .catch(err => console.error('✗ Microphone failed:', err));
```

**Test Display/Speaker Access:**
```javascript
navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
  .then(stream => {
    console.log('✓ Display + audio works!', stream);
    stream.getTracks().forEach(track => track.stop()); // Cleanup
  })
  .catch(err => console.error('✗ Display failed:', err));
```

#### Step 4: Restart Capture

After setting audio mode to "both":
1. Click **Stop** button in the app (if capture is running)
2. Click **Start** button to begin new capture
3. Grant permissions when prompted

#### Step 5: Verify Audio Is Being Captured

Run the diagnostic script:
```javascript
// In DevTools Console, paste the contents of scripts/fix-audio-capture.js
// Or if the script is loaded, just run it
```

You should see:
- ✅ Audio Mode: `both`
- ✅ Video Tracks: 1 (for screen)
- ✅ Audio Tracks: 1 (for speaker via loopback)
- ✅ micAudioProcessor: EXISTS (for microphone)

### Platform-Specific Notes

#### Windows (Your Platform)
- **Speaker Audio**: Captured via `getDisplayMedia` with audio loopback
- **Microphone**: Captured separately via `getUserMedia` when mode is `both` or `mic_only`
- Both streams are processed independently and sent to the AI service

#### Common Windows Issues

1. **"Share audio" checkbox not checked**
   - When the screen share dialog appears, make sure the "Share audio" checkbox is SELECTED
   - This is required for speaker audio capture

2. **Microphone permission denied**
   - Go to Windows Settings → Privacy → Microphone
   - Enable microphone access for your browser

3. **Browser compatibility**
   - Chrome/Edge: Full support ✅
   - Firefox: May have issues with audio loopback
   - Recommended: Use Chrome or Edge on Windows

### Advanced Debugging

If issues persist, check these:

#### Check Audio Processing State
```javascript
console.log({
  audioContext: window.audioContext?.state,
  audioProcessor: !!window.audioProcessor,
  micAudioProcessor: !!window.micAudioProcessor,
  mediaStream: !!window.mediaStream,
  audioTracks: window.mediaStream?.getAudioTracks().length || 0
});
```

#### Check AI Provider Configuration
```javascript
// Check which provider is active
const llmService = localStorage.getItem('llmService');
console.log('AI Provider:', llmService); // Should be 'gemini' or 'azure'

// If using Azure, check audio routing
console.log('Audio routing active:', window.audioRouter?.routingActive);
```

#### Monitor Audio Data Flow

Open DevTools and look for these console messages:
- `"Windows capture started with loopback audio"` - Speaker audio initialized ✅
- `"Windows microphone capture started"` - Microphone initialized ✅
- `"send-audio-content"` - Speaker audio being sent to AI ✅
- `"send-mic-audio-content"` - Microphone audio being sent to AI ✅

### Still Not Working?

If audio still doesn't work after trying all the above:

1. **Check DevTools Console for errors**
   - Look for red error messages
   - Common errors: "Permission denied", "NotFoundError", "NotAllowedError"

2. **Restart the entire application**
   - Close the app completely
   - Reopen it
   - Set audio mode to "both" again
   - Start capture with fresh permissions

3. **Try a different browser**
   - Close current browser
   - Open app in Chrome or Edge (recommended for Windows)

4. **Check system audio devices**
   - Ensure microphone and speakers are properly connected
   - Test in Windows Sound Settings that devices work
   - Make sure devices are not muted

### Manual Configuration via UI

If your app has an audio mode selector in the UI:
1. Look for an "Audio Mode" or "Audio Settings" option
2. Select "Both" or "Microphone + Speaker"
3. Save settings
4. Restart capture

### Code Reference

The audio capture logic is in:
- **File**: `src/utils/renderer.js`
- **Function**: `startCapture()`
- **Lines**: 430-590 (Windows-specific: 544-585)

Key code sections:
- Audio mode read: Line 430
- Windows speaker setup: Lines 544-560
- Windows microphone setup: Lines 565-583
- Audio processing: Lines 673-699 (loopback), 609-635 (mic)

### Summary Checklist

- [ ] Set audio mode: `localStorage.setItem('audioMode', 'both')`
- [ ] Stop and restart capture
- [ ] Grant display permission with "Share audio" checked
- [ ] Grant microphone permission
- [ ] Verify in console: audio tracks present
- [ ] Test microphone independently
- [ ] Test display/speaker independently
- [ ] Check for console errors

If you've done all of this and it still doesn't work, there may be a deeper browser or system configuration issue.
