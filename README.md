# Scrypted Privacy Manager

A Scrypted plugin that provides granular privacy controls for cameras, allowing you to disable recording, events, streaming, and detection on a per-camera basis with time-based scheduling.

## Features

### Per-Camera Privacy Controls
- **Block Recording**: Prevent video from being recorded
- **Block Events**: Suppress motion and detection events
- **Block Streaming**: Block live video streaming and snapshots
- **Block Detection**: Disable object detection processing
- **Block Motion Alerts**: Suppress motion detection notifications

### Privacy Profiles
Create named profiles that apply settings to groups of cameras:
- **Night Mode**: Indoor cameras OFF, outdoor cameras ON
- **Away Mode**: All cameras ON
- **Home Mode**: Indoor cameras OFF during the day
- **Custom profiles**: Create your own

### Time-Based Scheduling
Configure automatic privacy based on time:
- **Daily**: Apply privacy settings every day
- **Weekdays**: Monday through Friday only
- **Weekends**: Saturday and Sunday only
- **Custom**: Select specific days

Example: Disable indoor camera recording from 8 AM to 10 PM on weekdays.

### Panic Mode (Quick Toggle)
One-click button to immediately block ALL cameras:
- Overrides all settings, schedules, and profiles
- Exposed as a Home Assistant switch for automation

### Home Assistant Integration
All profiles and panic mode are exposed as switches:
- `switch.privacy_panic_mode`
- `switch.privacy_night_mode`
- `switch.privacy_away_mode`
- etc.

### Webhook Notifications
HTTP POST notifications when privacy settings change:
```json
{
  "event": "privacy_changed",
  "timestamp": "2024-01-08T10:30:00Z",
  "camera": "Living Room Camera",
  "cameraId": "abc123",
  "settings": {
    "blockRecording": true,
    "blockEvents": true,
    "blockStreaming": false,
    "blockDetection": true,
    "blockMotionAlerts": true
  },
  "trigger": "schedule"
}
```

### Audit Logging
Track all privacy setting changes:
- Timestamp
- Camera affected
- Previous and new settings
- Trigger (manual, schedule, profile, panic)

## Installation

### From NPM
```bash
npm install @blueharford/scrypted-privacy-manager
```

### In Scrypted
1. Go to **Plugins** in the Scrypted web interface
2. Click **Install Plugin**
3. Search for "Privacy Manager" or paste the NPM package name
4. Click **Install**

## Configuration

### Global Settings
Access via **Plugins > Privacy Manager > Settings**:

| Setting | Description |
|---------|-------------|
| Panic Mode | Emergency: Block ALL cameras immediately |
| Default Settings | Default privacy settings for new cameras |
| Webhook URL | HTTP endpoint for notifications |
| Webhook Events | Which events trigger webhooks |
| Audit Log Retention | Days to keep audit entries |

### Per-Camera Settings
Each camera will have a **Privacy Controls** section in its settings:

| Setting | Description |
|---------|-------------|
| Enable Privacy Controls | Master switch for this camera |
| Block Recording | Prevent recording |
| Block Events | Suppress events |
| Block Streaming | Block live video |
| Block Detection | Disable object detection |
| Block Motion Alerts | Suppress motion alerts |
| Enable Schedule | Use time-based automation |
| Schedule Type | Daily/Weekdays/Weekends/Custom |
| Privacy Start Time | When privacy mode activates |
| Privacy End Time | When privacy mode deactivates |

### Creating Profiles
1. Go to **Plugins > Privacy Manager**
2. Click **Add New Device**
3. Enter a profile name (e.g., "Night Mode")
4. Configure the profile:
   - Select cameras to include
   - Set which privacy options to apply
5. Toggle the profile on/off as needed

## HTTP API

The plugin exposes HTTP endpoints:

### GET /status
Returns current status:
```json
{
  "panicMode": false,
  "profiles": [
    { "id": "profile-123", "name": "Night Mode", "active": true, "cameraCount": 3 }
  ],
  "schedules": {
    "totalSchedules": 5,
    "activeSchedules": 2
  }
}
```

### GET /audit
Returns audit log as JSON.

### POST /panic
Enable/disable panic mode:
```json
{ "enabled": true }
```

## Use Cases

### Indoor Cameras During Day
Disable recording on indoor cameras while you're home:

1. Create a profile "Home Mode"
2. Add all indoor cameras
3. Enable: Block Recording, Block Events, Block Detection
4. Set schedule: Daily, 8:00 AM - 10:00 PM

### Privacy When Working From Home
Disable office camera during work hours:

1. Go to office camera settings
2. Enable schedule
3. Type: Weekdays
4. Start: 09:00, End: 17:00

### Instant Privacy
Need immediate privacy?

1. Open Scrypted or Home Assistant
2. Turn on "Privacy: Panic Mode"
3. All cameras immediately stop recording/streaming

## Development

### Building
```bash
npm install
npm run build
```

### Local Development
```bash
npm run scrypted-deploy-debug
```

## License

Apache-2.0

## Author

blueharford

## Links

- [NPM Package](https://www.npmjs.com/package/@blueharford/scrypted-privacy-manager)
- [GitHub Repository](https://github.com/blueharford/scrypted-privacy-manager)
- [Scrypted](https://www.scrypted.app)
