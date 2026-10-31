# Beyond the Walls

A Roblox game. So far this folder has the main menu.

## Add the main menu to your game

1. In Roblox Studio, open the Explorer and go to **StarterPlayer > StarterPlayerScripts**.
2. Right-click it, choose **Insert Object > LocalScript**, and name it `MainMenu`.
3. Paste in everything from [`MainMenu.client.lua`](MainMenu.client.lua).
4. Press **Play**.

The menu shows the title and the Deploy, Inventory, Shop, Trading and Settings buttons. Deploy closes the menu and
Inventory opens the inventory screen. The other buttons only print a message for now. Change what each one does in
the `ACTIONS` table at the bottom of the script.

## Inventory screen

Add [`Inventory.client.lua`](Inventory.client.lua) the same way, as a second LocalScript named `Inventory` in
**StarterPlayerScripts**.

It shows the current weapon (Sword or Spear, switched with the **swap** button), a picture of it, and a Stats panel
with Damage, ODM Speed, ODM Range, Blade Durability and Gas. **Upgrade** spends SP to raise the weapon's level and
all of its stats, up to level 10. **back** returns to the main menu.

- Open it from your own menu with `player.PlayerGui:WaitForChild("Inventory").Enabled = true`.
- SP is the player's `SP` attribute and starts at 10. A server script can give SP with `player:SetAttribute("SP", 25)`.
- Change the numbers for each weapon in the `WEAPONS` table near the top.
- Upgrades are not saved yet. They reset when the player leaves.

## Titan face

[`art/titan-face.png`](art/titan-face.png) is a 1024×1024 face texture with a see-through background, cleaned up from
the hand drawing. [`art/titan-face.svg`](art/titan-face.svg) is the editable source.

To put it on a block in Studio:

1. Insert a **Part** and make it a cube (for example, Size `20, 20, 20`).
2. Right-click the Part and choose **Insert Object > Decal**. Leave its **Face** set to `Front`.
3. Click the Decal's **Texture** property, choose **Add Image**, and pick `titan-face.png`.
