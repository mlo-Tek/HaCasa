# First run

The first time a user opens HaCasa Nova, a setup assistant appears. Every step can be skipped, and everything can be changed later under **More → Panel settings**.

![Setup wizard](assets/screenshots/wizard.png)

The first question is **how you want to set up**:

- **Automatic**: like before. Every device that is found shows up by itself. Four short steps: welcome, rooms, home page, photos.
- **Choose myself**: nothing is shown until you pick it. The assistant walks through the home page and then room by room. See below.
- **Later**: only the rooms are set up; every page stays empty and you fill it under *Page settings* when you like. You can also **import a settings file** here, for example one exported from another user.

## Choose myself

1. **Welcome**: language, title, and (optional) a backup of the current settings as a file.
2. **Rooms**: tick the areas that become rooms, set their order, give a room another name or a photo.
3. **Home page**: weather, thermostat, alarm panel, power sensor.
4. **Cards on the home page**: pick the cards, scenes included. A small preview shows what the page will look like.
5. **Status row**: which buttons sit under the greeting, who is home, and which notices the line shows.
6. **Motion & doorbell**, **Quick actions**: sensors for the bar at the bottom, camera pop-up, buttons under the greeting.
7. **One step per room**: devices are grouped by type (lights, heating, media, covers, switches, sensors) with a search field. Nothing is chosen by default; **Use recommendation** picks lights and heating, **Like another room** copies the kinds of cards of a room you already did. Several media players that belong to one device are shown as a single card.
8. **Never show**: devices that must appear nowhere, such as sensors in a storage room. Batteries and diagnostic entities are listed separately.
9. **Photos**.

Devices that appear later (a new lamp, a new sensor) are not added by themselves. A notice on the home page and on the room page tells you that something new was found, and you choose where it goes.

## How rooms are built

A room is a Home Assistant **area**. Every entity assigned to that area, directly or through its device, is placed on the room page as a card. To move a lamp to another room, change its area in Home Assistant.

Entities with the *diagnostic* or *config* category are left out (except batteries, which feed the Attention list). Room temperature and humidity come from the area's temperature and humidity sensors.

If you use **floors** in Home Assistant, the navigation can group rooms per floor: **Settings → General → Navigation → per floor**.

## Settings are per user

Settings are stored with Home Assistant's frontend user data, per user. They follow you to every phone, tablet and browser where you log in, and survive updates of the panel. Each member of the household can arrange the panel their own way.

To copy a setup to another user or another Home Assistant, use **Settings → General → Settings file → Export**, then **Import** on the other side.

## Running it again

**Settings → General → Setup wizard** runs the assistant again at any time. **Reset everything** (top of the settings page) clears all settings of the current user.
