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
