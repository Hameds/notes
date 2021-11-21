'use strict';

var obsidian = require('obsidian');

class Settings {
    constructor() {
        this.fileDirections = {};
        this.defaultDirection = 'ltr';
        this.rememberPerFile = true;
        this.setNoteTitleDirection = true;
        this.setYamlDirection = false;
    }
    toJson() {
        return JSON.stringify(this);
    }
    fromJson(content) {
        var obj = JSON.parse(content);
        this.fileDirections = obj['fileDirections'];
        this.defaultDirection = obj['defaultDirection'];
        this.rememberPerFile = obj['rememberPerFile'];
        this.setNoteTitleDirection = obj['setNoteTitleDirection'];
    }
}
class RtlPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.settings = new Settings();
        this.SETTINGS_PATH = '.obsidian/rtl.json';
        // This stores the value in CodeMirror's autoCloseBrackets option before overriding it, so it can be restored when
        // we're back to LTR
        this.autoCloseBracketsValue = false;
    }
    onload() {
        console.log('loading RTL plugin');
        this.addCommand({
            id: 'switch-text-direction',
            name: 'Switch Text Direction (LTR<>RTL)',
            callback: () => { this.toggleDocumentDirection(); }
        });
        this.addSettingTab(new RtlSettingsTab(this.app, this));
        this.loadSettings();
        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            if (file && file.path) {
                this.currentFile = file;
                this.adjustDirectionToCurrentFile();
            }
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file && file.path && file.path in this.settings.fileDirections) {
                delete this.settings.fileDirections[file.path];
                this.saveSettings();
            }
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (file && file.path && oldPath in this.settings.fileDirections) {
                this.settings.fileDirections[file.path] = this.settings.fileDirections[oldPath];
                delete this.settings.fileDirections[oldPath];
                this.saveSettings();
            }
        }));
        this.registerCodeMirror((cm) => {
            let cmEditor = cm;
            let currentExtraKeys = cmEditor.getOption('extraKeys');
            let moreKeys = {
                'End': (cm) => {
                    if (cm.getOption('direction') == 'rtl')
                        cm.execCommand('goLineLeftSmart');
                    else
                        cm.execCommand('goLineRight');
                },
                'Home': (cm) => {
                    if (cm.getOption('direction') == 'rtl')
                        cm.execCommand('goLineRight');
                    else
                        cm.execCommand('goLineLeftSmart');
                }
            };
            cmEditor.setOption('extraKeys', Object.assign({}, currentExtraKeys, moreKeys));
        });
    }
    onunload() {
        console.log('unloading RTL plugin');
    }
    adjustDirectionToCurrentFile() {
        if (this.currentFile && this.currentFile.path) {
            let requiredDirection = null;
            const frontMatterDirection = this.getFrontMatterDirection(this.currentFile);
            if (frontMatterDirection) {
                if (frontMatterDirection == 'rtl' || frontMatterDirection == 'ltr')
                    requiredDirection = frontMatterDirection;
                else
                    console.log('Front matter direction in file', this.currentFile.path, 'is unknown:', frontMatterDirection);
            }
            else if (this.settings.rememberPerFile && this.currentFile.path in this.settings.fileDirections) {
                // If the user wants to remember the direction per file, and we have a direction set for this file -- use it
                requiredDirection = this.settings.fileDirections[this.currentFile.path];
            }
            else {
                // Use the default direction
                requiredDirection = this.settings.defaultDirection;
            }
            this.setDocumentDirection(requiredDirection);
        }
    }
    saveSettings() {
        var settings = this.settings.toJson();
        this.app.vault.adapter.write(this.SETTINGS_PATH, settings);
    }
    loadSettings() {
        this.app.vault.adapter.read(this.SETTINGS_PATH).
            then((content) => this.settings.fromJson(content)).
            catch(error => { console.log("RTL settings file not found"); });
    }
    getObsidianEditor() {
        let view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (view)
            return view.editor;
        return null;
    }
    getCmEditor() {
        var _a;
        let view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (view)
            return (_a = view.sourceMode) === null || _a === void 0 ? void 0 : _a.cmEditor;
        return null;
    }
    setDocumentDirection(newDirection) {
        var cmEditor = this.getCmEditor();
        if (cmEditor && cmEditor.getOption("direction") != newDirection) {
            this.patchAutoCloseBrackets(cmEditor, newDirection);
            cmEditor.setOption("direction", newDirection);
            cmEditor.setOption("rtlMoveVisually", true);
        }
        let view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (view && view.previewMode && view.previewMode.containerEl)
            view.previewMode.containerEl.dir = newDirection;
        if (view) {
            // Fix the list indentation style
            this.replacePageStyleByString('CodeMirror-rtl pre', `.CodeMirror-rtl pre { text-indent: 0px !important; }`, true);
            if (this.settings.setYamlDirection) {
                const alignSide = newDirection == 'rtl' ? 'right' : 'left';
                this.replacePageStyleByString('Patch YAML', `/* Patch YAML RTL */ .language-yml code { text-align: ${alignSide}; }`, true);
            }
            if (this.settings.setNoteTitleDirection) {
                var leafContainer = this.app.workspace.activeLeaf.containerEl;
                let header = leafContainer.getElementsByClassName('view-header-title-container');
                header[0].style.direction = newDirection;
            }
            this.setExportDirection(newDirection);
        }
    }
    setExportDirection(newDirection) {
        this.replacePageStyleByString('searched and replaced', `/* This is searched and replaced by the plugin */ @media print { body { direction: ${newDirection}; } }`, false);
    }
    replacePageStyleByString(searchString, newStyle, addIfNotFound) {
        let styles = document.head.getElementsByTagName('style');
        let found = false;
        for (let style of styles) {
            if (style.getText().includes(searchString)) {
                style.setText(newStyle);
                found = true;
            }
        }
        if (!found && addIfNotFound) {
            let style = document.createElement('style');
            style.textContent = newStyle;
            document.head.appendChild(style);
        }
    }
    patchAutoCloseBrackets(cmEditor, newDirection) {
        // Auto-close brackets doesn't work in RTL: https://github.com/esm7/obsidian-rtl/issues/7
        // Until the actual fix is released (as part of CodeMirror), we store the value of autoCloseBrackets when
        // switching to RTL, overriding it to 'false' and restoring it when back to LTR.
        if (newDirection == 'rtl') {
            this.autoCloseBracketsValue = cmEditor.getOption('autoCloseBrackets');
            cmEditor.setOption('autoCloseBrackets', false);
        }
        else {
            cmEditor.setOption('autoCloseBrackets', this.autoCloseBracketsValue);
        }
    }
    toggleDocumentDirection() {
        var cmEditor = this.getCmEditor();
        if (cmEditor) {
            var newDirection = cmEditor.getOption("direction") == "ltr" ? "rtl" : "ltr";
            this.setDocumentDirection(newDirection);
            if (this.settings.rememberPerFile && this.currentFile && this.currentFile.path) {
                this.settings.fileDirections[this.currentFile.path] = newDirection;
                this.saveSettings();
            }
        }
    }
    getFrontMatterDirection(file) {
        const fileCache = this.app.metadataCache.getFileCache(file);
        const frontMatter = fileCache === null || fileCache === void 0 ? void 0 : fileCache.frontmatter;
        if (frontMatter && (frontMatter === null || frontMatter === void 0 ? void 0 : frontMatter.direction)) {
            try {
                const direction = frontMatter.direction;
                return direction;
            }
            catch (error) { }
        }
    }
}
class RtlSettingsTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.settings = plugin.settings;
    }
    display() {
        let { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'RTL Settings' });
        new obsidian.Setting(containerEl)
            .setName('Remember text direction per file')
            .setDesc('Store and remember the text direction used for each file individually.')
            .addToggle(toggle => toggle.setValue(this.settings.rememberPerFile)
            .onChange((value) => {
            this.settings.rememberPerFile = value;
            this.plugin.saveSettings();
            this.plugin.adjustDirectionToCurrentFile();
        }));
        new obsidian.Setting(containerEl)
            .setName('Default text direction')
            .setDesc('What should be the default text direction in Obsidian?')
            .addDropdown(dropdown => dropdown.addOption('ltr', 'LTR')
            .addOption('rtl', 'RTL')
            .setValue(this.settings.defaultDirection)
            .onChange((value) => {
            this.settings.defaultDirection = value;
            this.plugin.saveSettings();
            this.plugin.adjustDirectionToCurrentFile();
        }));
        new obsidian.Setting(containerEl)
            .setName('Set note title direction')
            .setDesc('In RTL notes, also set the direction of the note title.')
            .addToggle(toggle => toggle.setValue(this.settings.setNoteTitleDirection)
            .onChange((value) => {
            this.settings.setNoteTitleDirection = value;
            this.plugin.saveSettings();
            this.plugin.adjustDirectionToCurrentFile();
        }));
        new obsidian.Setting(containerEl)
            .setName('Set YAML direction in Preview')
            .setDesc('For RTL notes, preview YAML blocks as RTL. (When turning off, restart of Obsidian is required.)')
            .addToggle(toggle => {
            var _a;
            return toggle.setValue((_a = this.settings.setYamlDirection) !== null && _a !== void 0 ? _a : false)
                .onChange((value) => {
                this.settings.setYamlDirection = value;
                this.plugin.saveSettings();
                this.plugin.adjustDirectionToCurrentFile();
            });
        });
    }
}

module.exports = RtlPlugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibWFpbi50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHAsIEVkaXRvciwgTWFya2Rvd25WaWV3LCBQbHVnaW4sIFBsdWdpblNldHRpbmdUYWIsIFRGaWxlLCBUQWJzdHJhY3RGaWxlLCBTZXR0aW5nIH0gZnJvbSAnb2JzaWRpYW4nO1xyXG5pbXBvcnQgKiBhcyBjb2RlbWlycm9yIGZyb20gJ2NvZGVtaXJyb3InO1xyXG5cclxuY2xhc3MgU2V0dGluZ3Mge1xyXG5cdHB1YmxpYyBmaWxlRGlyZWN0aW9uczogeyBbcGF0aDogc3RyaW5nXTogc3RyaW5nIH0gPSB7fTtcclxuXHRwdWJsaWMgZGVmYXVsdERpcmVjdGlvbjogc3RyaW5nID0gJ2x0cic7XHJcblx0cHVibGljIHJlbWVtYmVyUGVyRmlsZTogYm9vbGVhbiA9IHRydWU7XHJcblx0cHVibGljIHNldE5vdGVUaXRsZURpcmVjdGlvbjogYm9vbGVhbiA9IHRydWU7XHJcblx0cHVibGljIHNldFlhbWxEaXJlY3Rpb246IGJvb2xlYW4gPSBmYWxzZTtcclxuXHJcblx0dG9Kc29uKCkge1xyXG5cdFx0cmV0dXJuIEpTT04uc3RyaW5naWZ5KHRoaXMpO1xyXG5cdH1cclxuXHJcblx0ZnJvbUpzb24oY29udGVudDogc3RyaW5nKSB7XHJcblx0XHR2YXIgb2JqID0gSlNPTi5wYXJzZShjb250ZW50KTtcclxuXHRcdHRoaXMuZmlsZURpcmVjdGlvbnMgPSBvYmpbJ2ZpbGVEaXJlY3Rpb25zJ107XHJcblx0XHR0aGlzLmRlZmF1bHREaXJlY3Rpb24gPSBvYmpbJ2RlZmF1bHREaXJlY3Rpb24nXTtcclxuXHRcdHRoaXMucmVtZW1iZXJQZXJGaWxlID0gb2JqWydyZW1lbWJlclBlckZpbGUnXTtcclxuXHRcdHRoaXMuc2V0Tm90ZVRpdGxlRGlyZWN0aW9uID0gb2JqWydzZXROb3RlVGl0bGVEaXJlY3Rpb24nXTtcclxuXHR9XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFJ0bFBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XHJcblxyXG5cdHB1YmxpYyBzZXR0aW5ncyA9IG5ldyBTZXR0aW5ncygpO1xyXG5cdHByaXZhdGUgY3VycmVudEZpbGU6IFRGaWxlO1xyXG5cdHB1YmxpYyBTRVRUSU5HU19QQVRIID0gJy5vYnNpZGlhbi9ydGwuanNvbidcclxuXHQvLyBUaGlzIHN0b3JlcyB0aGUgdmFsdWUgaW4gQ29kZU1pcnJvcidzIGF1dG9DbG9zZUJyYWNrZXRzIG9wdGlvbiBiZWZvcmUgb3ZlcnJpZGluZyBpdCwgc28gaXQgY2FuIGJlIHJlc3RvcmVkIHdoZW5cclxuXHQvLyB3ZSdyZSBiYWNrIHRvIExUUlxyXG5cdHByaXZhdGUgYXV0b0Nsb3NlQnJhY2tldHNWYWx1ZTogYW55ID0gZmFsc2U7XHJcblxyXG5cdG9ubG9hZCgpIHtcclxuXHRcdGNvbnNvbGUubG9nKCdsb2FkaW5nIFJUTCBwbHVnaW4nKTtcclxuXHJcblx0XHR0aGlzLmFkZENvbW1hbmQoe1xyXG5cdFx0XHRpZDogJ3N3aXRjaC10ZXh0LWRpcmVjdGlvbicsXHJcblx0XHRcdG5hbWU6ICdTd2l0Y2ggVGV4dCBEaXJlY3Rpb24gKExUUjw+UlRMKScsXHJcblx0XHRcdGNhbGxiYWNrOiAoKSA9PiB7IHRoaXMudG9nZ2xlRG9jdW1lbnREaXJlY3Rpb24oKTsgfVxyXG5cdFx0fSk7XHJcblxyXG5cdFx0dGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBSdGxTZXR0aW5nc1RhYih0aGlzLmFwcCwgdGhpcykpO1xyXG5cclxuXHRcdHRoaXMubG9hZFNldHRpbmdzKCk7XHJcblxyXG5cdFx0dGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLndvcmtzcGFjZS5vbignZmlsZS1vcGVuJywgKGZpbGU6IFRGaWxlKSA9PiB7XHJcblx0XHRcdGlmIChmaWxlICYmIGZpbGUucGF0aCkge1xyXG5cdFx0XHRcdHRoaXMuY3VycmVudEZpbGUgPSBmaWxlO1xyXG5cdFx0XHRcdHRoaXMuYWRqdXN0RGlyZWN0aW9uVG9DdXJyZW50RmlsZSgpO1xyXG5cdFx0XHR9XHJcblx0XHR9KSk7XHJcblxyXG5cdFx0dGhpcy5yZWdpc3RlckV2ZW50KHRoaXMuYXBwLnZhdWx0Lm9uKCdkZWxldGUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xyXG5cdFx0XHRpZiAoZmlsZSAmJiBmaWxlLnBhdGggJiYgZmlsZS5wYXRoIGluIHRoaXMuc2V0dGluZ3MuZmlsZURpcmVjdGlvbnMpIHtcclxuXHRcdFx0XHRkZWxldGUgdGhpcy5zZXR0aW5ncy5maWxlRGlyZWN0aW9uc1tmaWxlLnBhdGhdO1xyXG5cdFx0XHRcdHRoaXMuc2F2ZVNldHRpbmdzKCk7XHJcblx0XHRcdH1cclxuXHRcdH0pKTtcclxuXHJcblx0XHR0aGlzLnJlZ2lzdGVyRXZlbnQodGhpcy5hcHAudmF1bHQub24oJ3JlbmFtZScsIChmaWxlOiBUQWJzdHJhY3RGaWxlLCBvbGRQYXRoOiBzdHJpbmcpID0+IHtcclxuXHRcdFx0aWYgKGZpbGUgJiYgZmlsZS5wYXRoICYmIG9sZFBhdGggaW4gdGhpcy5zZXR0aW5ncy5maWxlRGlyZWN0aW9ucykge1xyXG5cdFx0XHRcdHRoaXMuc2V0dGluZ3MuZmlsZURpcmVjdGlvbnNbZmlsZS5wYXRoXSA9IHRoaXMuc2V0dGluZ3MuZmlsZURpcmVjdGlvbnNbb2xkUGF0aF07XHJcblx0XHRcdFx0ZGVsZXRlIHRoaXMuc2V0dGluZ3MuZmlsZURpcmVjdGlvbnNbb2xkUGF0aF07XHJcblx0XHRcdFx0dGhpcy5zYXZlU2V0dGluZ3MoKTtcclxuXHRcdFx0fVxyXG5cdFx0fSkpO1xyXG5cclxuXHRcdHRoaXMucmVnaXN0ZXJDb2RlTWlycm9yKChjbTogQ29kZU1pcnJvci5FZGl0b3IpID0+IHtcclxuXHRcdFx0bGV0IGNtRWRpdG9yID0gY207XHJcblx0XHRcdGxldCBjdXJyZW50RXh0cmFLZXlzID0gY21FZGl0b3IuZ2V0T3B0aW9uKCdleHRyYUtleXMnKTtcclxuXHRcdFx0bGV0IG1vcmVLZXlzID0ge1xyXG5cdFx0XHRcdCdFbmQnOiAoY206IENvZGVNaXJyb3IuRWRpdG9yKSA9PiB7XHJcblx0XHRcdFx0XHRpZiAoY20uZ2V0T3B0aW9uKCdkaXJlY3Rpb24nKSA9PSAncnRsJylcclxuXHRcdFx0XHRcdFx0Y20uZXhlY0NvbW1hbmQoJ2dvTGluZUxlZnRTbWFydCcpO1xyXG5cdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRjbS5leGVjQ29tbWFuZCgnZ29MaW5lUmlnaHQnKTtcclxuXHRcdFx0XHR9LFxyXG5cdFx0XHRcdCdIb21lJzogKGNtOiBDb2RlTWlycm9yLkVkaXRvcikgPT4ge1xyXG5cdFx0XHRcdFx0aWYgKGNtLmdldE9wdGlvbignZGlyZWN0aW9uJykgPT0gJ3J0bCcpXHJcblx0XHRcdFx0XHRcdGNtLmV4ZWNDb21tYW5kKCdnb0xpbmVSaWdodCcpO1xyXG5cdFx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0XHRjbS5leGVjQ29tbWFuZCgnZ29MaW5lTGVmdFNtYXJ0Jyk7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9O1xyXG5cdFx0XHRjbUVkaXRvci5zZXRPcHRpb24oJ2V4dHJhS2V5cycsIE9iamVjdC5hc3NpZ24oe30sIGN1cnJlbnRFeHRyYUtleXMsIG1vcmVLZXlzKSk7XHJcblx0XHR9KTtcclxuXHJcblx0fVxyXG5cclxuXHRvbnVubG9hZCgpIHtcclxuXHRcdGNvbnNvbGUubG9nKCd1bmxvYWRpbmcgUlRMIHBsdWdpbicpO1xyXG5cdH1cclxuXHJcblx0YWRqdXN0RGlyZWN0aW9uVG9DdXJyZW50RmlsZSgpIHtcclxuXHRcdGlmICh0aGlzLmN1cnJlbnRGaWxlICYmIHRoaXMuY3VycmVudEZpbGUucGF0aCkge1xyXG5cdFx0XHRsZXQgcmVxdWlyZWREaXJlY3Rpb24gPSBudWxsO1xyXG5cdFx0XHRjb25zdCBmcm9udE1hdHRlckRpcmVjdGlvbiA9IHRoaXMuZ2V0RnJvbnRNYXR0ZXJEaXJlY3Rpb24odGhpcy5jdXJyZW50RmlsZSk7XHJcblx0XHRcdGlmIChmcm9udE1hdHRlckRpcmVjdGlvbikge1xyXG5cdFx0XHRcdGlmIChmcm9udE1hdHRlckRpcmVjdGlvbiA9PSAncnRsJyB8fCBmcm9udE1hdHRlckRpcmVjdGlvbiA9PSAnbHRyJylcclxuXHRcdFx0XHRcdHJlcXVpcmVkRGlyZWN0aW9uID0gZnJvbnRNYXR0ZXJEaXJlY3Rpb247XHJcblx0XHRcdFx0ZWxzZVxyXG5cdFx0XHRcdFx0Y29uc29sZS5sb2coJ0Zyb250IG1hdHRlciBkaXJlY3Rpb24gaW4gZmlsZScsIHRoaXMuY3VycmVudEZpbGUucGF0aCwgJ2lzIHVua25vd246JywgZnJvbnRNYXR0ZXJEaXJlY3Rpb24pO1xyXG5cdFx0XHR9XHJcblx0XHRcdGVsc2UgaWYgKHRoaXMuc2V0dGluZ3MucmVtZW1iZXJQZXJGaWxlICYmIHRoaXMuY3VycmVudEZpbGUucGF0aCBpbiB0aGlzLnNldHRpbmdzLmZpbGVEaXJlY3Rpb25zKSB7XHJcblx0XHRcdFx0Ly8gSWYgdGhlIHVzZXIgd2FudHMgdG8gcmVtZW1iZXIgdGhlIGRpcmVjdGlvbiBwZXIgZmlsZSwgYW5kIHdlIGhhdmUgYSBkaXJlY3Rpb24gc2V0IGZvciB0aGlzIGZpbGUgLS0gdXNlIGl0XHJcblx0XHRcdFx0cmVxdWlyZWREaXJlY3Rpb24gPSB0aGlzLnNldHRpbmdzLmZpbGVEaXJlY3Rpb25zW3RoaXMuY3VycmVudEZpbGUucGF0aF07XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0Ly8gVXNlIHRoZSBkZWZhdWx0IGRpcmVjdGlvblxyXG5cdFx0XHRcdHJlcXVpcmVkRGlyZWN0aW9uID0gdGhpcy5zZXR0aW5ncy5kZWZhdWx0RGlyZWN0aW9uO1xyXG5cdFx0XHR9XHJcblx0XHRcdHRoaXMuc2V0RG9jdW1lbnREaXJlY3Rpb24ocmVxdWlyZWREaXJlY3Rpb24pO1xyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0c2F2ZVNldHRpbmdzKCkge1xyXG5cdFx0dmFyIHNldHRpbmdzID0gdGhpcy5zZXR0aW5ncy50b0pzb24oKTtcclxuXHRcdHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIud3JpdGUodGhpcy5TRVRUSU5HU19QQVRILCBzZXR0aW5ncyk7XHJcblx0fVxyXG5cclxuXHRsb2FkU2V0dGluZ3MoKSB7XHJcblx0XHR0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQodGhpcy5TRVRUSU5HU19QQVRIKS5cclxuXHRcdFx0dGhlbigoY29udGVudCkgPT4gdGhpcy5zZXR0aW5ncy5mcm9tSnNvbihjb250ZW50KSkuXHJcblx0XHRcdGNhdGNoKGVycm9yID0+IHsgY29uc29sZS5sb2coXCJSVEwgc2V0dGluZ3MgZmlsZSBub3QgZm91bmRcIik7IH0pO1xyXG5cdH1cclxuXHJcblx0Z2V0T2JzaWRpYW5FZGl0b3IoKTogRWRpdG9yIHtcclxuXHRcdGxldCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcclxuXHRcdGlmICh2aWV3KVxyXG5cdFx0XHRyZXR1cm4gdmlldy5lZGl0b3I7XHJcblx0XHRyZXR1cm4gbnVsbDtcclxuXHR9XHJcblxyXG5cdGdldENtRWRpdG9yKCk6IGNvZGVtaXJyb3IuRWRpdG9yIHtcclxuXHRcdGxldCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcclxuXHRcdGlmICh2aWV3KVxyXG5cdFx0XHRyZXR1cm4gdmlldy5zb3VyY2VNb2RlPy5jbUVkaXRvcjtcclxuXHRcdHJldHVybiBudWxsO1xyXG5cdH1cclxuXHJcblx0c2V0RG9jdW1lbnREaXJlY3Rpb24obmV3RGlyZWN0aW9uOiBzdHJpbmcpIHtcclxuXHRcdHZhciBjbUVkaXRvciA9IHRoaXMuZ2V0Q21FZGl0b3IoKTtcclxuXHRcdGlmIChjbUVkaXRvciAmJiBjbUVkaXRvci5nZXRPcHRpb24oXCJkaXJlY3Rpb25cIikgIT0gbmV3RGlyZWN0aW9uKSB7XHJcblx0XHRcdHRoaXMucGF0Y2hBdXRvQ2xvc2VCcmFja2V0cyhjbUVkaXRvciwgbmV3RGlyZWN0aW9uKTtcclxuXHRcdFx0Y21FZGl0b3Iuc2V0T3B0aW9uKFwiZGlyZWN0aW9uXCIsIG5ld0RpcmVjdGlvbiBhcyBhbnkpO1xyXG5cdFx0XHRjbUVkaXRvci5zZXRPcHRpb24oXCJydGxNb3ZlVmlzdWFsbHlcIiwgdHJ1ZSk7XHJcblx0XHR9XHJcblx0XHRsZXQgdmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XHJcblx0XHRpZiAodmlldyAmJiB2aWV3LnByZXZpZXdNb2RlICYmIHZpZXcucHJldmlld01vZGUuY29udGFpbmVyRWwpXHJcblx0XHRcdHZpZXcucHJldmlld01vZGUuY29udGFpbmVyRWwuZGlyID0gbmV3RGlyZWN0aW9uO1xyXG5cclxuXHRcdGlmICh2aWV3KSB7XHJcblx0XHRcdC8vIEZpeCB0aGUgbGlzdCBpbmRlbnRhdGlvbiBzdHlsZVxyXG5cdFx0XHR0aGlzLnJlcGxhY2VQYWdlU3R5bGVCeVN0cmluZygnQ29kZU1pcnJvci1ydGwgcHJlJyxcclxuXHRcdFx0XHRgLkNvZGVNaXJyb3ItcnRsIHByZSB7IHRleHQtaW5kZW50OiAwcHggIWltcG9ydGFudDsgfWAsXHJcblx0XHRcdFx0dHJ1ZSk7XHJcblxyXG5cdFx0XHRpZiAodGhpcy5zZXR0aW5ncy5zZXRZYW1sRGlyZWN0aW9uKSB7XHJcblx0XHRcdFx0Y29uc3QgYWxpZ25TaWRlID0gbmV3RGlyZWN0aW9uID09ICdydGwnID8gJ3JpZ2h0JyA6ICdsZWZ0JztcclxuXHRcdFx0XHR0aGlzLnJlcGxhY2VQYWdlU3R5bGVCeVN0cmluZygnUGF0Y2ggWUFNTCcsXHJcblx0XHRcdFx0XHRgLyogUGF0Y2ggWUFNTCBSVEwgKi8gLmxhbmd1YWdlLXltbCBjb2RlIHsgdGV4dC1hbGlnbjogJHthbGlnblNpZGV9OyB9YCwgdHJ1ZSk7XHJcblx0XHRcdH1cclxuXHJcblx0XHRcdGlmICh0aGlzLnNldHRpbmdzLnNldE5vdGVUaXRsZURpcmVjdGlvbikge1xyXG5cdFx0XHRcdHZhciBsZWFmQ29udGFpbmVyID0gKHRoaXMuYXBwLndvcmtzcGFjZS5hY3RpdmVMZWFmIGFzIGFueSkuY29udGFpbmVyRWwgYXMgRG9jdW1lbnQ7XHJcblx0XHRcdFx0bGV0IGhlYWRlciA9IGxlYWZDb250YWluZXIuZ2V0RWxlbWVudHNCeUNsYXNzTmFtZSgndmlldy1oZWFkZXItdGl0bGUtY29udGFpbmVyJyk7XHJcblx0XHRcdFx0KGhlYWRlclswXSBhcyBhbnkpLnN0eWxlLmRpcmVjdGlvbiA9IG5ld0RpcmVjdGlvbjtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0dGhpcy5zZXRFeHBvcnREaXJlY3Rpb24obmV3RGlyZWN0aW9uKTtcclxuXHRcdH1cclxuXHJcblx0fVxyXG5cclxuXHRzZXRFeHBvcnREaXJlY3Rpb24obmV3RGlyZWN0aW9uOiBzdHJpbmcpIHtcclxuXHRcdHRoaXMucmVwbGFjZVBhZ2VTdHlsZUJ5U3RyaW5nKCdzZWFyY2hlZCBhbmQgcmVwbGFjZWQnLFxyXG5cdFx0XHRgLyogVGhpcyBpcyBzZWFyY2hlZCBhbmQgcmVwbGFjZWQgYnkgdGhlIHBsdWdpbiAqLyBAbWVkaWEgcHJpbnQgeyBib2R5IHsgZGlyZWN0aW9uOiAke25ld0RpcmVjdGlvbn07IH0gfWAsXHJcblx0XHRcdGZhbHNlKTtcclxuXHR9XHJcblxyXG5cdHJlcGxhY2VQYWdlU3R5bGVCeVN0cmluZyhzZWFyY2hTdHJpbmc6IHN0cmluZywgbmV3U3R5bGU6IHN0cmluZywgYWRkSWZOb3RGb3VuZDogYm9vbGVhbikge1xyXG5cdFx0bGV0IHN0eWxlcyA9IGRvY3VtZW50LmhlYWQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3N0eWxlJyk7XHJcblx0XHRsZXQgZm91bmQgPSBmYWxzZTtcclxuXHRcdGZvciAobGV0IHN0eWxlIG9mIHN0eWxlcykge1xyXG5cdFx0XHRpZiAoc3R5bGUuZ2V0VGV4dCgpLmluY2x1ZGVzKHNlYXJjaFN0cmluZykpIHtcclxuXHRcdFx0XHRzdHlsZS5zZXRUZXh0KG5ld1N0eWxlKTtcclxuXHRcdFx0XHRmb3VuZCA9IHRydWU7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdGlmICghZm91bmQgJiYgYWRkSWZOb3RGb3VuZCkge1xyXG5cdFx0XHRsZXQgc3R5bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzdHlsZScpO1xyXG5cdFx0XHRzdHlsZS50ZXh0Q29udGVudCA9IG5ld1N0eWxlO1xyXG5cdFx0XHRkb2N1bWVudC5oZWFkLmFwcGVuZENoaWxkKHN0eWxlKTtcclxuXHRcdH1cclxuXHR9XHJcblxyXG5cdHBhdGNoQXV0b0Nsb3NlQnJhY2tldHMoY21FZGl0b3I6IGFueSwgbmV3RGlyZWN0aW9uOiBzdHJpbmcpIHtcclxuXHRcdC8vIEF1dG8tY2xvc2UgYnJhY2tldHMgZG9lc24ndCB3b3JrIGluIFJUTDogaHR0cHM6Ly9naXRodWIuY29tL2VzbTcvb2JzaWRpYW4tcnRsL2lzc3Vlcy83XHJcblx0XHQvLyBVbnRpbCB0aGUgYWN0dWFsIGZpeCBpcyByZWxlYXNlZCAoYXMgcGFydCBvZiBDb2RlTWlycm9yKSwgd2Ugc3RvcmUgdGhlIHZhbHVlIG9mIGF1dG9DbG9zZUJyYWNrZXRzIHdoZW5cclxuXHRcdC8vIHN3aXRjaGluZyB0byBSVEwsIG92ZXJyaWRpbmcgaXQgdG8gJ2ZhbHNlJyBhbmQgcmVzdG9yaW5nIGl0IHdoZW4gYmFjayB0byBMVFIuXHJcblx0XHRpZiAobmV3RGlyZWN0aW9uID09ICdydGwnKSB7XHJcblx0XHRcdHRoaXMuYXV0b0Nsb3NlQnJhY2tldHNWYWx1ZSA9IGNtRWRpdG9yLmdldE9wdGlvbignYXV0b0Nsb3NlQnJhY2tldHMnKTtcclxuXHRcdFx0Y21FZGl0b3Iuc2V0T3B0aW9uKCdhdXRvQ2xvc2VCcmFja2V0cycsIGZhbHNlKTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdGNtRWRpdG9yLnNldE9wdGlvbignYXV0b0Nsb3NlQnJhY2tldHMnLCB0aGlzLmF1dG9DbG9zZUJyYWNrZXRzVmFsdWUpO1xyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0dG9nZ2xlRG9jdW1lbnREaXJlY3Rpb24oKSB7XHJcblx0XHR2YXIgY21FZGl0b3IgPSB0aGlzLmdldENtRWRpdG9yKCk7XHJcblx0XHRpZiAoY21FZGl0b3IpIHtcclxuXHRcdFx0dmFyIG5ld0RpcmVjdGlvbiA9IGNtRWRpdG9yLmdldE9wdGlvbihcImRpcmVjdGlvblwiKSA9PSBcImx0clwiID8gXCJydGxcIiA6IFwibHRyXCJcclxuXHRcdFx0dGhpcy5zZXREb2N1bWVudERpcmVjdGlvbihuZXdEaXJlY3Rpb24pO1xyXG5cdFx0XHRpZiAodGhpcy5zZXR0aW5ncy5yZW1lbWJlclBlckZpbGUgJiYgdGhpcy5jdXJyZW50RmlsZSAmJiB0aGlzLmN1cnJlbnRGaWxlLnBhdGgpIHtcclxuXHRcdFx0XHR0aGlzLnNldHRpbmdzLmZpbGVEaXJlY3Rpb25zW3RoaXMuY3VycmVudEZpbGUucGF0aF0gPSBuZXdEaXJlY3Rpb247XHJcblx0XHRcdFx0dGhpcy5zYXZlU2V0dGluZ3MoKTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0Z2V0RnJvbnRNYXR0ZXJEaXJlY3Rpb24oZmlsZTogVEZpbGUpIHtcclxuXHRcdGNvbnN0IGZpbGVDYWNoZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpO1xyXG5cdFx0Y29uc3QgZnJvbnRNYXR0ZXIgPSBmaWxlQ2FjaGU/LmZyb250bWF0dGVyO1xyXG5cdFx0aWYgKGZyb250TWF0dGVyICYmIGZyb250TWF0dGVyPy5kaXJlY3Rpb24pIHtcclxuXHRcdFx0dHJ5IHtcclxuXHRcdFx0XHRjb25zdCBkaXJlY3Rpb24gPSBmcm9udE1hdHRlci5kaXJlY3Rpb247XHJcblx0XHRcdFx0cmV0dXJuIGRpcmVjdGlvbjtcclxuXHRcdFx0fVxyXG5cdFx0XHRjYXRjaCAoZXJyb3IpIHt9XHJcblx0XHR9XHJcblx0fVxyXG59XHJcblxyXG5jbGFzcyBSdGxTZXR0aW5nc1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xyXG5cdHNldHRpbmdzOiBTZXR0aW5ncztcclxuXHRwbHVnaW46IFJ0bFBsdWdpbjtcclxuXHJcblx0Y29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogUnRsUGx1Z2luKSB7XHJcblx0XHRzdXBlcihhcHAsIHBsdWdpbik7XHJcblx0XHR0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuXHRcdHRoaXMuc2V0dGluZ3MgPSBwbHVnaW4uc2V0dGluZ3M7XHJcblx0fVxyXG5cclxuXHRkaXNwbGF5KCk6IHZvaWQge1xyXG5cdFx0bGV0IHtjb250YWluZXJFbH0gPSB0aGlzO1xyXG5cclxuXHRcdGNvbnRhaW5lckVsLmVtcHR5KCk7XHJcblxyXG5cdFx0Y29udGFpbmVyRWwuY3JlYXRlRWwoJ2gyJywge3RleHQ6ICdSVEwgU2V0dGluZ3MnfSk7XHJcblxyXG5cdFx0bmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcblx0XHRcdC5zZXROYW1lKCdSZW1lbWJlciB0ZXh0IGRpcmVjdGlvbiBwZXIgZmlsZScpXHJcblx0XHRcdC5zZXREZXNjKCdTdG9yZSBhbmQgcmVtZW1iZXIgdGhlIHRleHQgZGlyZWN0aW9uIHVzZWQgZm9yIGVhY2ggZmlsZSBpbmRpdmlkdWFsbHkuJylcclxuXHRcdFx0LmFkZFRvZ2dsZSh0b2dnbGUgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMuc2V0dGluZ3MucmVtZW1iZXJQZXJGaWxlKVxyXG5cdFx0XHRcdFx0ICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xyXG5cdFx0XHRcdFx0XHQgICB0aGlzLnNldHRpbmdzLnJlbWVtYmVyUGVyRmlsZSA9IHZhbHVlO1xyXG5cdFx0XHRcdFx0XHQgICB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuXHRcdFx0XHRcdFx0ICAgdGhpcy5wbHVnaW4uYWRqdXN0RGlyZWN0aW9uVG9DdXJyZW50RmlsZSgpO1xyXG5cdFx0XHRcdFx0ICAgfSkpO1xyXG5cclxuXHRcdG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxyXG5cdFx0XHQuc2V0TmFtZSgnRGVmYXVsdCB0ZXh0IGRpcmVjdGlvbicpXHJcblx0XHRcdC5zZXREZXNjKCdXaGF0IHNob3VsZCBiZSB0aGUgZGVmYXVsdCB0ZXh0IGRpcmVjdGlvbiBpbiBPYnNpZGlhbj8nKVxyXG5cdFx0XHQuYWRkRHJvcGRvd24oZHJvcGRvd24gPT4gZHJvcGRvd24uYWRkT3B0aW9uKCdsdHInLCAnTFRSJylcclxuXHRcdFx0XHRcdFx0IC5hZGRPcHRpb24oJ3J0bCcsICdSVEwnKVxyXG5cdFx0XHRcdFx0XHQgLnNldFZhbHVlKHRoaXMuc2V0dGluZ3MuZGVmYXVsdERpcmVjdGlvbilcclxuXHRcdFx0XHRcdFx0IC5vbkNoYW5nZSgodmFsdWUpID0+IHtcclxuXHRcdFx0XHRcdFx0XHQgdGhpcy5zZXR0aW5ncy5kZWZhdWx0RGlyZWN0aW9uID0gdmFsdWU7XHJcblx0XHRcdFx0XHRcdFx0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG5cdFx0XHRcdFx0XHRcdCB0aGlzLnBsdWdpbi5hZGp1c3REaXJlY3Rpb25Ub0N1cnJlbnRGaWxlKCk7XHJcblx0XHRcdFx0XHRcdCB9KSk7XHJcblxyXG5cdFx0bmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcblx0XHRcdC5zZXROYW1lKCdTZXQgbm90ZSB0aXRsZSBkaXJlY3Rpb24nKVxyXG5cdFx0XHQuc2V0RGVzYygnSW4gUlRMIG5vdGVzLCBhbHNvIHNldCB0aGUgZGlyZWN0aW9uIG9mIHRoZSBub3RlIHRpdGxlLicpXHJcblx0XHRcdC5hZGRUb2dnbGUodG9nZ2xlID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnNldHRpbmdzLnNldE5vdGVUaXRsZURpcmVjdGlvbilcclxuXHRcdFx0XHRcdFx0IC5vbkNoYW5nZSgodmFsdWUpID0+IHtcclxuXHRcdFx0XHRcdFx0XHQgdGhpcy5zZXR0aW5ncy5zZXROb3RlVGl0bGVEaXJlY3Rpb24gPSB2YWx1ZTtcclxuXHRcdFx0XHRcdFx0XHQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcblx0XHRcdFx0XHRcdFx0IHRoaXMucGx1Z2luLmFkanVzdERpcmVjdGlvblRvQ3VycmVudEZpbGUoKTtcclxuXHRcdFx0XHRcdFx0IH0pKTtcclxuXHJcblx0XHRuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuXHRcdFx0LnNldE5hbWUoJ1NldCBZQU1MIGRpcmVjdGlvbiBpbiBQcmV2aWV3JylcclxuXHRcdFx0LnNldERlc2MoJ0ZvciBSVEwgbm90ZXMsIHByZXZpZXcgWUFNTCBibG9ja3MgYXMgUlRMLiAoV2hlbiB0dXJuaW5nIG9mZiwgcmVzdGFydCBvZiBPYnNpZGlhbiBpcyByZXF1aXJlZC4pJylcclxuXHRcdFx0LmFkZFRvZ2dsZSh0b2dnbGUgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMuc2V0dGluZ3Muc2V0WWFtbERpcmVjdGlvbiA/PyBmYWxzZSlcclxuXHRcdFx0XHRcdFx0IC5vbkNoYW5nZSgodmFsdWUpID0+IHtcclxuXHRcdFx0XHRcdFx0XHQgdGhpcy5zZXR0aW5ncy5zZXRZYW1sRGlyZWN0aW9uID0gdmFsdWU7XHJcblx0XHRcdFx0XHRcdFx0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG5cdFx0XHRcdFx0XHRcdCB0aGlzLnBsdWdpbi5hZGp1c3REaXJlY3Rpb25Ub0N1cnJlbnRGaWxlKCk7XHJcblx0XHRcdFx0XHRcdCB9KSk7XHJcblx0fVxyXG59XHJcbiJdLCJuYW1lcyI6WyJQbHVnaW4iLCJNYXJrZG93blZpZXciLCJQbHVnaW5TZXR0aW5nVGFiIiwiU2V0dGluZyJdLCJtYXBwaW5ncyI6Ijs7OztBQUdBLE1BQU0sUUFBUTtJQUFkO1FBQ1EsbUJBQWMsR0FBK0IsRUFBRSxDQUFDO1FBQ2hELHFCQUFnQixHQUFXLEtBQUssQ0FBQztRQUNqQyxvQkFBZSxHQUFZLElBQUksQ0FBQztRQUNoQywwQkFBcUIsR0FBWSxJQUFJLENBQUM7UUFDdEMscUJBQWdCLEdBQVksS0FBSyxDQUFDO0tBYXpDO0lBWEEsTUFBTTtRQUNMLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQztLQUM1QjtJQUVELFFBQVEsQ0FBQyxPQUFlO1FBQ3ZCLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDOUIsSUFBSSxDQUFDLGNBQWMsR0FBRyxHQUFHLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztRQUM1QyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUM7UUFDaEQsSUFBSSxDQUFDLGVBQWUsR0FBRyxHQUFHLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUM5QyxJQUFJLENBQUMscUJBQXFCLEdBQUcsR0FBRyxDQUFDLHVCQUF1QixDQUFDLENBQUM7S0FDMUQ7Q0FDRDtNQUVvQixTQUFVLFNBQVFBLGVBQU07SUFBN0M7O1FBRVEsYUFBUSxHQUFHLElBQUksUUFBUSxFQUFFLENBQUM7UUFFMUIsa0JBQWEsR0FBRyxvQkFBb0IsQ0FBQTs7O1FBR25DLDJCQUFzQixHQUFRLEtBQUssQ0FBQztLQXdNNUM7SUF0TUEsTUFBTTtRQUNMLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLENBQUMsQ0FBQztRQUVsQyxJQUFJLENBQUMsVUFBVSxDQUFDO1lBQ2YsRUFBRSxFQUFFLHVCQUF1QjtZQUMzQixJQUFJLEVBQUUsa0NBQWtDO1lBQ3hDLFFBQVEsRUFBRSxRQUFRLElBQUksQ0FBQyx1QkFBdUIsRUFBRSxDQUFDLEVBQUU7U0FDbkQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUM7UUFFdkQsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBRXBCLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDLElBQVc7WUFDakUsSUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRTtnQkFDdEIsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLENBQUM7Z0JBQ3hCLElBQUksQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO2FBQ3BDO1NBQ0QsQ0FBQyxDQUFDLENBQUM7UUFFSixJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxJQUFtQjtZQUNsRSxJQUFJLElBQUksSUFBSSxJQUFJLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLEVBQUU7Z0JBQ25FLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUMvQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7YUFDcEI7U0FDRCxDQUFDLENBQUMsQ0FBQztRQUVKLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQW1CLEVBQUUsT0FBZTtZQUNuRixJQUFJLElBQUksSUFBSSxJQUFJLENBQUMsSUFBSSxJQUFJLE9BQU8sSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsRUFBRTtnQkFDakUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUNoRixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUM3QyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7YUFDcEI7U0FDRCxDQUFDLENBQUMsQ0FBQztRQUVKLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLEVBQXFCO1lBQzdDLElBQUksUUFBUSxHQUFHLEVBQUUsQ0FBQztZQUNsQixJQUFJLGdCQUFnQixHQUFHLFFBQVEsQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDdkQsSUFBSSxRQUFRLEdBQUc7Z0JBQ2QsS0FBSyxFQUFFLENBQUMsRUFBcUI7b0JBQzVCLElBQUksRUFBRSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsSUFBSSxLQUFLO3dCQUNyQyxFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7O3dCQUVsQyxFQUFFLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQyxDQUFDO2lCQUMvQjtnQkFDRCxNQUFNLEVBQUUsQ0FBQyxFQUFxQjtvQkFDN0IsSUFBSSxFQUFFLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEtBQUs7d0JBQ3JDLEVBQUUsQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDLENBQUM7O3dCQUU5QixFQUFFLENBQUMsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7aUJBQ25DO2FBQ0QsQ0FBQztZQUNGLFFBQVEsQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLGdCQUFnQixFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUM7U0FDL0UsQ0FBQyxDQUFDO0tBRUg7SUFFRCxRQUFRO1FBQ1AsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO0tBQ3BDO0lBRUQsNEJBQTRCO1FBQzNCLElBQUksSUFBSSxDQUFDLFdBQVcsSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRTtZQUM5QyxJQUFJLGlCQUFpQixHQUFHLElBQUksQ0FBQztZQUM3QixNQUFNLG9CQUFvQixHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDNUUsSUFBSSxvQkFBb0IsRUFBRTtnQkFDekIsSUFBSSxvQkFBb0IsSUFBSSxLQUFLLElBQUksb0JBQW9CLElBQUksS0FBSztvQkFDakUsaUJBQWlCLEdBQUcsb0JBQW9CLENBQUM7O29CQUV6QyxPQUFPLENBQUMsR0FBRyxDQUFDLGdDQUFnQyxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO2FBQzNHO2lCQUNJLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxjQUFjLEVBQUU7O2dCQUVoRyxpQkFBaUIsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO2FBQ3hFO2lCQUFNOztnQkFFTixpQkFBaUIsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDO2FBQ25EO1lBQ0QsSUFBSSxDQUFDLG9CQUFvQixDQUFDLGlCQUFpQixDQUFDLENBQUM7U0FDN0M7S0FDRDtJQUVELFlBQVk7UUFDWCxJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ3RDLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxRQUFRLENBQUMsQ0FBQztLQUMzRDtJQUVELFlBQVk7UUFDWCxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUM7WUFDOUMsSUFBSSxDQUFDLENBQUMsT0FBTyxLQUFLLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQ2xELEtBQUssQ0FBQyxLQUFLLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0tBQ2pFO0lBRUQsaUJBQWlCO1FBQ2hCLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLG1CQUFtQixDQUFDQyxxQkFBWSxDQUFDLENBQUM7UUFDaEUsSUFBSSxJQUFJO1lBQ1AsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDO1FBQ3BCLE9BQU8sSUFBSSxDQUFDO0tBQ1o7SUFFRCxXQUFXOztRQUNWLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLG1CQUFtQixDQUFDQSxxQkFBWSxDQUFDLENBQUM7UUFDaEUsSUFBSSxJQUFJO1lBQ1AsYUFBTyxJQUFJLENBQUMsVUFBVSwwQ0FBRSxRQUFRLENBQUM7UUFDbEMsT0FBTyxJQUFJLENBQUM7S0FDWjtJQUVELG9CQUFvQixDQUFDLFlBQW9CO1FBQ3hDLElBQUksUUFBUSxHQUFHLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUNsQyxJQUFJLFFBQVEsSUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxJQUFJLFlBQVksRUFBRTtZQUNoRSxJQUFJLENBQUMsc0JBQXNCLENBQUMsUUFBUSxFQUFFLFlBQVksQ0FBQyxDQUFDO1lBQ3BELFFBQVEsQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFLFlBQW1CLENBQUMsQ0FBQztZQUNyRCxRQUFRLENBQUMsU0FBUyxDQUFDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxDQUFDO1NBQzVDO1FBQ0QsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLENBQUNBLHFCQUFZLENBQUMsQ0FBQztRQUNoRSxJQUFJLElBQUksSUFBSSxJQUFJLENBQUMsV0FBVyxJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsV0FBVztZQUMzRCxJQUFJLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxHQUFHLEdBQUcsWUFBWSxDQUFDO1FBRWpELElBQUksSUFBSSxFQUFFOztZQUVULElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxvQkFBb0IsRUFDakQsc0RBQXNELEVBQ3RELElBQUksQ0FBQyxDQUFDO1lBRVAsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLGdCQUFnQixFQUFFO2dCQUNuQyxNQUFNLFNBQVMsR0FBRyxZQUFZLElBQUksS0FBSyxHQUFHLE9BQU8sR0FBRyxNQUFNLENBQUM7Z0JBQzNELElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxZQUFZLEVBQ3pDLHlEQUF5RCxTQUFTLEtBQUssRUFBRSxJQUFJLENBQUMsQ0FBQzthQUNoRjtZQUVELElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxxQkFBcUIsRUFBRTtnQkFDeEMsSUFBSSxhQUFhLEdBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsVUFBa0IsQ0FBQyxXQUF1QixDQUFDO2dCQUNuRixJQUFJLE1BQU0sR0FBRyxhQUFhLENBQUMsc0JBQXNCLENBQUMsNkJBQTZCLENBQUMsQ0FBQztnQkFDaEYsTUFBTSxDQUFDLENBQUMsQ0FBUyxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsWUFBWSxDQUFDO2FBQ2xEO1lBRUQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLFlBQVksQ0FBQyxDQUFDO1NBQ3RDO0tBRUQ7SUFFRCxrQkFBa0IsQ0FBQyxZQUFvQjtRQUN0QyxJQUFJLENBQUMsd0JBQXdCLENBQUMsdUJBQXVCLEVBQ3BELHNGQUFzRixZQUFZLE9BQU8sRUFDekcsS0FBSyxDQUFDLENBQUM7S0FDUjtJQUVELHdCQUF3QixDQUFDLFlBQW9CLEVBQUUsUUFBZ0IsRUFBRSxhQUFzQjtRQUN0RixJQUFJLE1BQU0sR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3pELElBQUksS0FBSyxHQUFHLEtBQUssQ0FBQztRQUNsQixLQUFLLElBQUksS0FBSyxJQUFJLE1BQU0sRUFBRTtZQUN6QixJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLEVBQUU7Z0JBQzNDLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQ3hCLEtBQUssR0FBRyxJQUFJLENBQUM7YUFDYjtTQUNEO1FBQ0QsSUFBSSxDQUFDLEtBQUssSUFBSSxhQUFhLEVBQUU7WUFDNUIsSUFBSSxLQUFLLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUM1QyxLQUFLLENBQUMsV0FBVyxHQUFHLFFBQVEsQ0FBQztZQUM3QixRQUFRLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQztTQUNqQztLQUNEO0lBRUQsc0JBQXNCLENBQUMsUUFBYSxFQUFFLFlBQW9COzs7O1FBSXpELElBQUksWUFBWSxJQUFJLEtBQUssRUFBRTtZQUMxQixJQUFJLENBQUMsc0JBQXNCLEdBQUcsUUFBUSxDQUFDLFNBQVMsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO1lBQ3RFLFFBQVEsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEVBQUUsS0FBSyxDQUFDLENBQUM7U0FDL0M7YUFBTTtZQUNOLFFBQVEsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLHNCQUFzQixDQUFDLENBQUM7U0FDckU7S0FDRDtJQUVELHVCQUF1QjtRQUN0QixJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDbEMsSUFBSSxRQUFRLEVBQUU7WUFDYixJQUFJLFlBQVksR0FBRyxRQUFRLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEtBQUssR0FBRyxLQUFLLEdBQUcsS0FBSyxDQUFBO1lBQzNFLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUN4QyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsZUFBZSxJQUFJLElBQUksQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUU7Z0JBQy9FLElBQUksQ0FBQyxRQUFRLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsWUFBWSxDQUFDO2dCQUNuRSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7YUFDcEI7U0FDRDtLQUNEO0lBRUQsdUJBQXVCLENBQUMsSUFBVztRQUNsQyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDNUQsTUFBTSxXQUFXLEdBQUcsU0FBUyxhQUFULFNBQVMsdUJBQVQsU0FBUyxDQUFFLFdBQVcsQ0FBQztRQUMzQyxJQUFJLFdBQVcsS0FBSSxXQUFXLGFBQVgsV0FBVyx1QkFBWCxXQUFXLENBQUUsU0FBUyxDQUFBLEVBQUU7WUFDMUMsSUFBSTtnQkFDSCxNQUFNLFNBQVMsR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDO2dCQUN4QyxPQUFPLFNBQVMsQ0FBQzthQUNqQjtZQUNELE9BQU8sS0FBSyxFQUFFLEdBQUU7U0FDaEI7S0FDRDtDQUNEO0FBRUQsTUFBTSxjQUFlLFNBQVFDLHlCQUFnQjtJQUk1QyxZQUFZLEdBQVEsRUFBRSxNQUFpQjtRQUN0QyxLQUFLLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ25CLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO1FBQ3JCLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQztLQUNoQztJQUVELE9BQU87UUFDTixJQUFJLEVBQUMsV0FBVyxFQUFDLEdBQUcsSUFBSSxDQUFDO1FBRXpCLFdBQVcsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUVwQixXQUFXLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxFQUFDLElBQUksRUFBRSxjQUFjLEVBQUMsQ0FBQyxDQUFDO1FBRW5ELElBQUlDLGdCQUFPLENBQUMsV0FBVyxDQUFDO2FBQ3RCLE9BQU8sQ0FBQyxrQ0FBa0MsQ0FBQzthQUMzQyxPQUFPLENBQUMsd0VBQXdFLENBQUM7YUFDakYsU0FBUyxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDO2FBQzdELFFBQVEsQ0FBQyxDQUFDLEtBQUs7WUFDZixJQUFJLENBQUMsUUFBUSxDQUFDLGVBQWUsR0FBRyxLQUFLLENBQUM7WUFDdEMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUMzQixJQUFJLENBQUMsTUFBTSxDQUFDLDRCQUE0QixFQUFFLENBQUM7U0FDM0MsQ0FBQyxDQUFDLENBQUM7UUFFVixJQUFJQSxnQkFBTyxDQUFDLFdBQVcsQ0FBQzthQUN0QixPQUFPLENBQUMsd0JBQXdCLENBQUM7YUFDakMsT0FBTyxDQUFDLHdEQUF3RCxDQUFDO2FBQ2pFLFdBQVcsQ0FBQyxRQUFRLElBQUksUUFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDO2FBQ3BELFNBQVMsQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDO2FBQ3ZCLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUFDO2FBQ3hDLFFBQVEsQ0FBQyxDQUFDLEtBQUs7WUFDZixJQUFJLENBQUMsUUFBUSxDQUFDLGdCQUFnQixHQUFHLEtBQUssQ0FBQztZQUN2QyxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQzNCLElBQUksQ0FBQyxNQUFNLENBQUMsNEJBQTRCLEVBQUUsQ0FBQztTQUMzQyxDQUFDLENBQUMsQ0FBQztRQUVULElBQUlBLGdCQUFPLENBQUMsV0FBVyxDQUFDO2FBQ3RCLE9BQU8sQ0FBQywwQkFBMEIsQ0FBQzthQUNuQyxPQUFPLENBQUMseURBQXlELENBQUM7YUFDbEUsU0FBUyxDQUFDLE1BQU0sSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMscUJBQXFCLENBQUM7YUFDcEUsUUFBUSxDQUFDLENBQUMsS0FBSztZQUNmLElBQUksQ0FBQyxRQUFRLENBQUMscUJBQXFCLEdBQUcsS0FBSyxDQUFDO1lBQzVDLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDM0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyw0QkFBNEIsRUFBRSxDQUFDO1NBQzNDLENBQUMsQ0FBQyxDQUFDO1FBRVQsSUFBSUEsZ0JBQU8sQ0FBQyxXQUFXLENBQUM7YUFDdEIsT0FBTyxDQUFDLCtCQUErQixDQUFDO2FBQ3hDLE9BQU8sQ0FBQyxpR0FBaUcsQ0FBQzthQUMxRyxTQUFTLENBQUMsTUFBTTs7WUFBSSxPQUFBLE1BQU0sQ0FBQyxRQUFRLE9BQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsbUNBQUksS0FBSyxDQUFDO2lCQUN4RSxRQUFRLENBQUMsQ0FBQyxLQUFLO2dCQUNmLElBQUksQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLEdBQUcsS0FBSyxDQUFDO2dCQUN2QyxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDO2dCQUMzQixJQUFJLENBQUMsTUFBTSxDQUFDLDRCQUE0QixFQUFFLENBQUM7YUFDM0MsQ0FBQyxDQUFBO1NBQUEsQ0FBQyxDQUFDO0tBQ1Q7Ozs7OyJ9
