# JMcartridges

A simpler alternative to [SteamCartridges](https://github.com/gunCannoli/steam-cartridges)

JMcartridges gives your non-Steam games descriptions, artwork, community content and achievements in Steam, with the aim of making these look consistent with purchased Steam games. The plugin slightly changes the look of your Steam game details for conformity with non-Steam games. It also allows you to add a Steam game to the plugin, especially useful for editing descriptions or giving life to a now delisted Steam game. 

![JMcartridges window](docs/window.png)

![non-Steam game](docs/game-page.jpg)

## Sources

| Source | Provides | Requires |
| --- | --- | --- |
| Steam | Game info, artwork, community content | Nothing |
| TheGamesDB (Recommended) | Game info, artwork, community content | API key |
| IGDB | Game info, artwork, community content | Twitch client ID and secret |
| SteamGridDB | Artwork | API key |
| RetroAchievements | Achievements | Username and Web API key |

## Adding games

JMcartridges works with the non-Steam games added to your library manually, and should be compatible with non-Steam games imported other ways, such as via Steam ROM manager. Once you've added games, you can click Auto Match to match everything at once, you can also match games manually on the bottom of the preview or on the properties > cartridge tab of a game in your Steam library. 

## Install

Run `JMcartridges.Installer.exe` from the [latest release](../../releases/latest).

Or extract `jmcartridges-<version>.zip` into `<Steam>/millennium/plugins/` and enable JMcartridges in your Millennium library.
