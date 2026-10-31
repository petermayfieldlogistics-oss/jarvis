# Beyond the Walls

A Roblox game. So far this folder has the main menu.

## Add the main menu to your game

1. In Roblox Studio, open the Explorer and go to **StarterPlayer > StarterPlayerScripts**.
2. Right-click it, choose **Insert Object > LocalScript**, and name it `MainMenu`.
3. Paste in everything from [`MainMenu.client.lua`](MainMenu.client.lua).
4. Press **Play**.

The menu shows the title and the Deploy, Inventory, Shop, Trading and Settings buttons. Deploy closes the menu. The
other buttons only print a message for now. Change what each one does in the `ACTIONS` table at the bottom of the
script.

## Titan face

[`art/titan-face.png`](art/titan-face.png) is a 1024×1024 face texture with a see-through background, cleaned up from
the hand drawing. [`art/titan-face.svg`](art/titan-face.svg) is the editable source.

To put it on a block in Studio:

1. Insert a **Part** and make it a cube (for example, Size `20, 20, 20`).
2. Right-click the Part and choose **Insert Object > Decal**. Leave its **Face** set to `Front`.
3. Click the Decal's **Texture** property, choose **Add Image**, and pick `titan-face.png`.
