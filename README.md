<p align="center">
  <img src="./src-angular/assets/images/bridge-animation.gif"/>
</p>
<h3 align="center">Bridge fork with multi-instrument search and Spotify playlist bulk download.</h3>
<img align="center" src="./src-angular/assets/images/example.png"/>
<hr>

**Bridge** is a desktop application that allows you to search for and download charts that can be played in games like Clone Hero, YARG, etc.

This is the desktop version of [Chorus Encore](https://www.enchor.us/).

This fork focuses on two changes on top of upstream Bridge:

- multi-instrument search in the main browser and advanced search
- Spotify playlist bulk download with instrument filtering

It also keeps the original Bridge desktop workflow and packaging flow, so it can be built and shipped like the upstream app.

## What is different here

- Search charts with more than one instrument at once, for example guitar plus pro drums
- Import a public Spotify playlist and bulk search matching charts
- Filter Spotify playlist results by the selected instrument set before download
- Keep the normal Bridge download queue and chart handling

This fork was created from Bridge v3.4.0.

## Build

```bash
pnpm install
pnpm build:mac
```

The macOS build is written to `release/` as a `.dmg`.


### Original Dev Socials

To discuss the project and make suggestions, please join the [Discord](https://discord.gg/cqaUXGm)

To help me pay for the server costs, please check out the [Patreon](https://www.patreon.com/ChorusEncore701)
