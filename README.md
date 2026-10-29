# Platiroom

Platiroom is a local manager for your PlayStation trophy collection. It fetches your PSN account data, stores it on your computer and presents it in an interface built to explore games, DLC, trophies and statistics.

> **Disclaimer:** this project is independent and has no affiliation, connection or endorsement with Sony Interactive Entertainment or PlayStation.

Official repository: <https://github.com/Grimmjow81/Platiroom>

---

## Main features

- **Local storage**: all data stays on your PC (the `json/` folder next to the executable). No personal data is sent to external servers; the only connections are to PlayStation services to download your trophies and to this repository to update the internal database.
- **Portable version**: no installation needed, just a folder with the executable.
- **My Games**: a list of all your games with progress, trophy counts by type, platinum rarity percentage, DLC and a detailed view of every trophy (rarity, date earned).
- **Custom tabs**: up to 6 lists (for example "Wishlist" or "To play") to which you can add any game from the PSN database, even ones you don't own.
- **Platiroom**: all your platinums in chronological order, the rarest ones and the milestones (1st, 10th, 50th, 100th...).
- **Statistics**: charts for trophy progression, level, activity over time, games and platinums per platform, and rarity distribution.
- **OUTATIME**: a list of missed trophies that can no longer be obtained.
- **PSNP+ database information**: guides and walkthroughs, difficulty and estimated hours, missable/buggy/online trophies, unobtainable trophies and upcoming server shutdowns.
- **Personal notes** you can add personal note for each game.
- **User Interface**: you can change the appearance of the Ui in 3 different styles: Classic, Modern or Platform (modern icons for PS5, classic for the others).

---

## Quick start

1. Download and open the program folder.
2. Run `Platiroom.exe`.
3. Click the 🔄 icon in the top right corner (**PSN Scraping**).
4. Get your NPSSO token (see below) and paste it into the field.
5. Press **Get your data** and wait. The first import can take several minutes, depending on how many games you have.
6. When it finishes, the list is loaded automatically.

Later updates are much faster: only games that changed are downloaded again.

### How to get your NPSSO token

1. Sign in to your PlayStation account in your browser.
2. In the same browser, open <https://ca.account.sony.com/api/v1/ssocookie>.
3. Copy the **64-character** code shown as `npsso`.
4. Paste it into the PSN Scraping window of Platiroom.

> ⚠️ The token grants access to your account: **do not share or publish it**. It is saved only in `json/Options.json`, locally.

---

## Tabs guide

### Welcome
Introduction, credits, update database and the list of upcoming server shutdowns.

### My Games
- **Console filters**: All, PS3, PS Vita, PS4, PS5, VR.
- **In Progress**: hides games and DLC that are 100% complete.
- **A-Z Sort**: switch to alphabetical order (normally last games played are on the top list).
- **Search**: by title, platform, region or NPWR code.
- **Expanding**: click a game to see its groups (base game and DLC), then click a group to see the individual trophies.
- **PSNP+ Badges**: difficulty, number of playthroughs needed, estimated hours, missable ⚠️, buggy 🐞, online 🌐 and unobtainable ❌ trophies, and server shutdown ⏳.
- **Guide buttons**: open the linked guides and walkthroughs in your browser.
- **Notes**: right-click the 📝 icon to write or edit a note; leave the text empty to remove it. Hover over the icon to read it.

### Custom tabs
- Use the **+** button in the tab bar to create a new tab (maximum 6, name up to 16 characters).
- **Right-click** a tab name to move it left/right, rename it or delete it.
- **Add new game**: search the PSN database (at least 3 characters) and pick a game. Trophy data is downloaded from PSN.
- The ✕ button on each row removes the game from the list.
- Tabs show trophy information but not progress, since they are not linked to your account.

### Platiroom
A list of all your platinums (most recent first), with side tables.

### Statistics
Interactive charts for trophy progression, level progression (with tier bands), activity per half-month, per-platform details and platinum rarity. **OUTATIME** is at the bottom.

---

## Options (⚙️)

| Option | Description |
|---|---|
| **Trophies style** | Classic, Modern or Platform. |
| **Platinum rarity** | Use the percentage from the *PSN platform* or a different rate, more focused on *Trophy Hunters*. |
| **Hide unreleased games** | Hides unreleased games when searching from custom tabs. |

---

## Data structure

All files are in the `json/` folder next to the executable:

| File | Content |
|---|---|
| `Options.json` | Settings and NPSSO token |
| `User_Account.json` | Profile, level and tier |
| `User_Games.json` | Your games and trophies |
| `User_Stat.json` | Statistics data |
| `User_Tabs.json` | Custom tab lists |
| `User_Note.json` | Game notes |
| `PSN_GamesMini.json` | PSN games database |
| `PSNP+_*.json` | Guides, unobtainable trophies and server shutdowns |

Images downloaded from PlayStation servers are saved in `img/cache/` to avoid downloading them again.

**Backup**: to save your collection, copy the `json/` folder.

---

## Building from source

Requirements: [Node.js](https://nodejs.org/), [Rust](https://www.rust-lang.org/tools/install) and the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run dev     # run in development
npm run build   # release build + portable/ folder
```

The build creates the `portable/` folder with the executable and the base `json/` files (without your personal data).

---

## Privacy

Your data and token stay on your computer. Network requests go only to PlayStation/Sony services (for trophies and images) and to your browser when you open an external link.

---

## Credits

- Designed and developed by **Grimmjow81**, with AI assistance.
- **Massicci0** for database construction and general testing.
- **Husky** for granting permission to integrate the [PSNP+](https://psnp-plus.huskycode.dev/) databases (guides, unobtainable trophies, server shutdowns).

PlayStation names and trademarks belong to their respective owners. Third-party data and images remain subject to their own terms.

---

## License

The source code is released under the [MIT License](LICENSE).

Third-party data and assets (PSNP+ databases, PlayStation trophy images, guide badges, fonts) are **not** covered by this license and remain under their respective terms.
