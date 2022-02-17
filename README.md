## Obsidian Liveblocks
by shabegom

A POC implementation of liveblocks.io inside an obsidian plugin.

### Install
1. Create an account at https://liveblocks.io
2. Grab you API Key: https://liveblocks.io/dashboard/apikeys
3. Clone the repo and create a `.env` file and add `API_KEY= Key from liveblocks`
4. npm run build and copy `main.js`, `styles.css` and `manifest.json` into your obsidian plugins folder
5. Enable the plugin in obsidian

### Usage
1. Create a `liveblocks` code block
2. Install in another vault and see if the cursors show up

### Warnings
- This is just a basic POC. It is more to show that one could integrate liveblocks into an obisidan plugin and shouldn't be used in a production system.
- Cursor position breaks really easily.

### TODO
- [ ] Add settings to setup auth and set a room name
- [ ] Track contents of whole notes with storageblocks
- [ ] Better cursor Decorations
- [ ] Maybe a Presence specific sidebar to show who is online?
