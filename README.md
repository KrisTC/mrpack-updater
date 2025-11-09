# Modrinth Pack Version Updater

A web-based tool to help manage updating Modrinth modpack (.mrpack) files to different Minecraft versions. This tool analyzes your modpack and checks which mods have compatible versions for your target Minecraft version.

## 🏗️ Refactored Architecture (Still Vibe Coded!)

This project has been refactored from a single monolithic HTML file into a cleaner structure with proper separation of concerns. While the file organization has been improved for maintainability, this remains fundamentally "vibe coded" - prioritizing functionality and getting things done over enterprise-grade architecture. The refactoring makes it easier to work with, but don't expect production-level code standards!

## Features

- 🔍 **Version Compatibility Checking**: Upload a .mrpack file and check which mods are available for a target Minecraft version
- 🎯 **Multi-Loader Support**: Supports Fabric, Quilt, Forge, and NeoForge modloaders
- 📦 **Automatic Pack Building**: Generates updated .mrpack files with compatible mod versions
- ❌ **Missing Items Tracker**: Track unavailable mods and get notified when they become available
- 🏗️ **Special Carpet Handling**: Enhanced support for Fabric Carpet mod with GitHub fallback
- 📊 **Detailed Reports**: Shows availability status, version numbers, and download information
- 🎨 **Category Support**: Handles mods, resource packs, and shader packs separately

## How It Works

1. **Upload**: Drop your existing .mrpack file into the tool
2. **Configure**: Select your target Minecraft version and modloader
3. **Analyze**: The tool checks Modrinth API for compatible versions of each mod
4. **Review**: See which mods have updates available and which don't
5. **Build**: Generate a new .mrpack with all available updates
6. **Track**: Remember missing items to get notified when unavailable mods become available

## Special Features

### Fabric Carpet Support
The tool includes special handling for Fabric Carpet mod:
- Falls back to GitHub releases when Modrinth doesn't have the version
- Automatically matches version patterns for better compatibility
- Supports both stable and prerelease versions

### Smart Version Selection
- Prioritizes release versions over beta/alpha
- Sorts by publication date for the most recent compatible version
- Maintains original file metadata for proper pack building

### Missing Items Tracker
- Track mods that aren't available for your target Minecraft version
- Automatic background checking for updates to unavailable mods
- Persistent storage across browser sessions using localStorage
- Get notifications when previously missing mods become available
- Multi-modpack support - track missing items from different modpacks

## Usage

1. Open `index.html` in a web browser
2. Click "Choose File" and select your .mrpack file
3. Select your target Minecraft version from the dropdown
4. Choose your modloader (Fabric, Quilt, Forge, NeoForge)
5. Click "Check" to analyze compatibility
6. Review the results in the generated tables
7. Click "Build updated .mrpack" to download an updated pack
8. Use "Remember missing items" to track unavailable mods
9. Click the red ❌ button to view and manage tracked missing items

## File Structure

```
├── index.html              # Clean HTML structure and semantic markup
├── styles.css              # All CSS styling and theming
├── script.js               # Application logic and API interactions
├── jszip-dist/             # JSZip library for handling .mrpack files
│   ├── jszip.js
│   └── jszip.min.js
├── host.sh                 # Local development server script
├── LICENSE                 # MIT License
├── README.md               # This file
└── .gitignore              # Git ignore file
```

## Architecture Benefits

### 🚀 Performance Improvements

- **Parallel Loading**: CSS and JavaScript can be downloaded simultaneously
- **Browser Caching**: Separate files allow better caching strategies
- **Reduced Initial Load**: HTML file reduced from 753 lines to just 58 lines (92% reduction)

### 🔧 Maintainability

- **Separation of Concerns**: HTML, CSS, and JavaScript properly separated
- **Easier Updates**: Modify styling in `styles.css` without touching logic
- **Better Debugging**: Clear file organization for development
- **Code Organization**: Related functions grouped logically

### 📁 File Breakdown

- **`index.html`**: Semantic HTML structure, accessibility attributes, clean markup
- **`styles.css`**: CSS custom properties, responsive design, dark/light theming
- **`script.js`**: API interactions, file processing, UI management, pack building

## Development

To run locally:

```bash
# Simple HTTP server (if you have host.sh)
./host.sh

# Or use Python
python3 -m http.server 8000

# Or use Node.js
npx serve .
```

Then open `http://localhost:8000` in your browser.

## API Dependencies

This tool relies on the following APIs:

- **Modrinth API v2**: For mod version and compatibility checking
- **GitHub API**: Fallback for Fabric Carpet mod releases
- **Minecraft Version Manifest**: For loading available MC versions

## Limitations

- ⚠️ **Still Vibe Coded**: Despite refactoring, this prioritizes "get it done" over perfect code architecture
- 🌐 **Client-Side Only**: All processing happens in the browser
- 📡 **API Rate Limits**: May hit rate limits with very large modpacks
- 🔄 **No Automatic Dependencies**: Doesn't automatically resolve mod dependencies
- 📱 **Limited Mobile Support**: Best used on desktop browsers

## Contributing

Contributions are welcome! While the files are now organized better, remember this is still fundamentally "vibe coded." When contributing:

- CSS changes go in `styles.css`
- JavaScript logic goes in `script.js`
- HTML structure changes go in `index.html`
- Don't expect enterprise-level code standards - this is about functionality first
- Feel free to improve the code quality, but understand the original spirit!

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

### Third-Party Licenses

- **JSZip**: Dual licensed under MIT/GPL v3 (this project uses the MIT license)

## Acknowledgments

- Built for the Minecraft modding community
- Uses the excellent Modrinth API for mod data
- Special thanks to the Fabric Carpet team for their GitHub releases
- Powered by JSZip for .mrpack file handling

---

**Note**: This tool is not affiliated with Modrinth or Minecraft. It's a community-created utility to help with modpack management.