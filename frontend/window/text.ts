// Every word the window and its settings block show; no other file holds text the user reads.

export const TEXT = {
    app: "JMcartridges",

    // The block in Millennium's plugin list.
    sectionOpen: "Open",
    sectionReady: (ready: number, total: number) => `${ready} of ${total} games ready`,
    sectionEmpty: "No non-Steam games yet",

    // The page in a game's Properties.
    cartridge: "Cartridge",

    // The window: top bar.
    search: "Search",
    options: "Options",
    close: "Close",
    autoMode: "Auto Match",
    summary: (ready: number, total: number) => `${ready} of ${total} ready`,
    noGames: "Add a non-Steam game in Steam, then open this window again.",
    loadFailed: "Could not read the library.",

    // Progress of Auto Match.
    progressFinding: (done: number, total: number) => `Finding matches ${done}/${total}`,
    progressDone: "Done",
    progressFailed: "Auto Match stopped. Try again.",

    // The list.
    listTitle: "Games",
    filterAll: "All",
    filterTodo: "To do",
    statusReady: "Ready",
    statusMatch: "No match",
    statusNew: "New",
    statusSkipped: "Disabled",
    listEmpty: "Nothing here.",

    // The game on the right.
    pickGame: "Pick a game.",
    preview: "Preview",
    previewNoDescription: "No description yet.",

    artTitle: "Artwork",
    slotPortrait: "Portrait",
    slotHero: "Background",
    slotLogo: "Logo",
    slotWide: "Wide",
    slotIcon: "Icon",
    change: "Change",
    reset: "Reset",
    remove: "Remove",

    matchTitle: "Match",
    matchSteam: "Steam",
    matchIgdb: "IGDB",
    matchNone: "None",
    matchSearchButton: "Search",
    matchNoSource: "No source is enabled.",
    matchUse: "Use",
    matchNoResults: "No results.",
    leaveAlone: "Exclude",
    include: "Include",
    unlink: "Unlink",

    infoTitle: "Game Info",
    fieldTitle: "Title",
    fieldDescription: "Description",
    fieldDevelopers: "Developers",
    fieldPublishers: "Publishers",
    fieldGenres: "Genres",
    fieldRelease: "Release date",
    fieldListHint: "Separate with ;",
    fieldDateHint: "YYYY-MM-DD",
    save: "Save",
    saved: "Saved",
    edited: "Edited",

    // The picture picker.
    pickerFile: "Choose file",
    noLogo: "No Logo",
    pickerLink: "Link or file path",
    pickerUse: "Use",
    pickerUseThis: "Save",
    cancel: "Cancel",
    pickerSearch: "Search",
    pickerEmpty: "No images found.",
    pickerLoading: "Loading",
    pickerNeedsKey: "More images need a SteamGridDB key.",
    sourceSteam: "Steam",
    sourceSteamGridDb: "SteamGridDB",
    sourceTheGamesDb: "TheGamesDB",
    sourceRetroAchievements: "RetroAchievements",

    // Options.
    optionsTitle: "Options",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    advanced: "Advanced settings",
    showInfo: "Show Game Info",
    showAchievements: "Show Achievements",
    communityContent: "Community content",
    descLimit: "Description character limit",

    // Sources.
    sources: "Sources",
    sourceOn: "Enabled",
    keyMissing: "No key",
    keySteamGridDb: "SteamGridDB key",
    keyIgdbId: "IGDB client ID",
    keyIgdbSecret: "IGDB client secret",
    keyTheGamesDb: "TheGamesDB key",
    keyRaUser: "RetroAchievements username",
    keyRaApi: "RetroAchievements Web API key",

    // Errors: the backend answers with a short code, the words are here.
    errors: {
        unsupported: "File cannot be used as an image.",
        "not-found": "File not found.",
        "too-large": "Image is larger than 24 MB.",
        "not-fetched": "Unable to get image.",
        "bad-link": "Not a valid link or file path.",
        "key-refused": "SteamGridDB refused the key.",
        "not-reached": "Unable to reach SteamGridDB.",
        "igdb-not-reached": "Unable to reach IGDB.",
        "steam-not-reached": "Unable to reach Steam.",
        "thegamesdb-not-reached": "Unable to reach TheGamesDB.",
        "no-backup": "Unable to copy current image.",
        "no-shortcut": "Steam's shortcut list could not be read.",
        "steam-refused": "Steam did not take the image.",
        "not-saved": "Unable to save.",
        "bad-date": "Use a date like 2011-04-19.",
        unknown: "Something went wrong. Try again.",
    } as Record<string, string>,
} as const;

/** The sentence for an error code; a source's code ("igdb-key-refused") reads as that source not being reached. */
export function errorText(code: string | undefined): string {
    if (code && TEXT.errors[code]) return TEXT.errors[code]!;
    const source = /^(steamgriddb|igdb|steam|thegamesdb)-(.+)$/.exec(code ?? "");
    if (source?.[1] === "steamgriddb") return TEXT.errors[source[2] === "key-refused" ? "key-refused" : "not-reached"]!;
    if (source) return TEXT.errors[`${source[1]}-not-reached`]!;
    return TEXT.errors.unknown!;
}
