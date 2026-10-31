--[[
	Beyond the Walls: inventory (weapon) screen

	Put this LocalScript in StarterPlayer > StarterPlayerScripts, next to MainMenu.
	It builds the screen from the sketch: a Back button, the weapon name with a
	swap button (Sword / Spear), a picture of the weapon, and a Stats panel with
	an Upgrade button that costs SP.

	The screen starts hidden. To open it from any LocalScript:
		player.PlayerGui:WaitForChild("Inventory").Enabled = true

	SP comes from the player's "SP" attribute. A server script can set it with
	player:SetAttribute("SP", 25). Upgrades here only last until the player
	leaves; saving them needs a server script with a DataStore.
]]

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local COLORS = {
	background = Color3.fromRGB(18, 15, 12),
	panel = Color3.fromRGB(34, 28, 22),
	ink = Color3.fromRGB(236, 228, 210),
	inkDim = Color3.fromRGB(160, 150, 132),
	line = Color3.fromRGB(120, 108, 90),
	barBack = Color3.fromRGB(60, 52, 42),
	bar = Color3.fromRGB(200, 170, 110),
	steel = Color3.fromRGB(200, 205, 212),
	steelDark = Color3.fromRGB(120, 126, 134),
	grip = Color3.fromRGB(70, 48, 32),
	upgrade = Color3.fromRGB(150, 44, 32),
	denied = Color3.fromRGB(90, 30, 26),
}

local FONT = Enum.Font.Fondamento
local TITLE_FONT = Enum.Font.GothamBlack

local MAX_LEVEL = 10
local BAR_MAX = 160
local STARTING_SP = 10

local STAT_ORDER = { "Damage", "ODM Speed", "ODM Range", "Blade Durability", "Gas" }

-- base = value at level 1, grow = how much each upgrade adds
local WEAPONS = {
	{
		name = "Sword",
		stats = {
			Damage = { base = 40, grow = 6 },
			["ODM Speed"] = { base = 70, grow = 4 },
			["ODM Range"] = { base = 60, grow = 3 },
			["Blade Durability"] = { base = 50, grow = 6 },
			Gas = { base = 60, grow = 4 },
		},
	},
	{
		name = "Spear",
		stats = {
			Damage = { base = 75, grow = 9 },
			["ODM Speed"] = { base = 55, grow = 3 },
			["ODM Range"] = { base = 60, grow = 3 },
			["Blade Durability"] = { base = 30, grow = 3 },
			Gas = { base = 50, grow = 4 },
		},
	},
}

local levels = { Sword = 1, Spear = 1 }
local current = 1

if player:GetAttribute("SP") == nil then
	player:SetAttribute("SP", STARTING_SP)
end

local function upgradeCost(level)
	return level + 2
end

local function statValue(weapon, statName)
	local stat = weapon.stats[statName]
	return stat.base + stat.grow * (levels[weapon.name] - 1)
end

---------------------------------------------------------------------------
-- Screen

local gui = Instance.new("ScreenGui")
gui.Name = "Inventory"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.Enabled = false
gui.DisplayOrder = 5
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local backdrop = Instance.new("Frame")
backdrop.Name = "Backdrop"
backdrop.Size = UDim2.fromScale(1, 1)
backdrop.BackgroundColor3 = COLORS.background
backdrop.BorderSizePixel = 0
backdrop.Parent = gui

-- Everything sits in a 16:9 box so it keeps its shape on any screen
local screen = Instance.new("Frame")
screen.Name = "Screen"
screen.AnchorPoint = Vector2.new(0.5, 0.5)
screen.Position = UDim2.fromScale(0.5, 0.5)
screen.Size = UDim2.fromScale(0.94, 0.94)
screen.BackgroundTransparency = 1
screen.Parent = backdrop

local aspect = Instance.new("UIAspectRatioConstraint")
aspect.AspectRatio = 16 / 9
aspect.Parent = screen

local function label(parent, props)
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Font = FONT
	l.TextColor3 = COLORS.ink
	l.TextScaled = true
	for key, value in pairs(props) do
		l[key] = value
	end
	l.Parent = parent
	return l
end

local function addCorner(parent, radius)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = parent
end

local function addStroke(parent, color, thickness)
	local stroke = Instance.new("UIStroke")
	stroke.Color = color
	stroke.Thickness = thickness
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Parent = parent
	return stroke
end

local function textButton(parent, name, text, props)
	local b = Instance.new("TextButton")
	b.Name = name
	b.AutoButtonColor = false
	b.BackgroundColor3 = COLORS.panel
	b.BorderSizePixel = 0
	b.Font = FONT
	b.Text = text
	b.TextColor3 = COLORS.ink
	b.TextScaled = true
	for key, value in pairs(props) do
		b[key] = value
	end
	b.Parent = parent
	addCorner(b, 10)
	addStroke(b, COLORS.line, 2)

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0.18, 0)
	padding.PaddingBottom = UDim.new(0.18, 0)
	padding.PaddingLeft = UDim.new(0, 10)
	padding.PaddingRight = UDim.new(0, 10)
	padding.Parent = b

	local rest = b.BackgroundColor3
	local info = TweenInfo.new(0.12)
	b.MouseEnter:Connect(function()
		TweenService:Create(b, info, { BackgroundColor3 = rest:Lerp(Color3.new(1, 1, 1), 0.12) }):Play()
	end)
	b.MouseLeave:Connect(function()
		TweenService:Create(b, info, { BackgroundColor3 = rest }):Play()
	end)
	return b
end

-- Back button, top left
local backButton = textButton(screen, "BackButton", "back", {
	Position = UDim2.fromScale(0, 0),
	Size = UDim2.fromScale(0.11, 0.08),
})

-- Weapon name with the swap button next to it
local titleBar = Instance.new("Frame")
titleBar.Name = "TitleBar"
titleBar.Position = UDim2.fromScale(0.14, 0)
titleBar.Size = UDim2.fromScale(0.44, 0.1)
titleBar.BackgroundTransparency = 1
titleBar.Parent = screen

local weaponTitle = label(titleBar, {
	Name = "WeaponName",
	Size = UDim2.fromScale(0.75, 1),
	Font = TITLE_FONT,
	Text = "SWORD",
})

local swapButton = textButton(titleBar, "SwapButton", "swap", {
	AnchorPoint = Vector2.new(1, 0.5),
	Position = UDim2.fromScale(1, 0.5),
	Size = UDim2.fromScale(0.2, 0.7),
})

local levelLabel = label(screen, {
	Name = "Level",
	Position = UDim2.fromScale(0.14, 0.1),
	Size = UDim2.fromScale(0.33, 0.05),
	TextColor3 = COLORS.inkDim,
	Text = "Level 1",
})

-- The weapon picture
local canvas = Instance.new("Frame")
canvas.Name = "WeaponPicture"
canvas.AnchorPoint = Vector2.new(0.5, 0.5)
canvas.Position = UDim2.fromScale(0.31, 0.58)
canvas.Size = UDim2.fromScale(0.5, 0.75)
canvas.BackgroundTransparency = 1
canvas.Parent = screen

local canvasAspect = Instance.new("UIAspectRatioConstraint")
canvasAspect.AspectRatio = 1
canvasAspect.Parent = canvas

-- The weapon drawings go in here so they can be cleared on swap
local art = Instance.new("Frame")
art.Name = "Art"
art.Size = UDim2.fromScale(1, 1)
art.BackgroundTransparency = 1
art.Parent = canvas

local function part(parent, props)
	local f = Instance.new("Frame")
	f.BorderSizePixel = 0
	for key, value in pairs(props) do
		f[key] = value
	end
	f.Parent = parent
	return f
end

local function shine(parent)
	local gradient = Instance.new("UIGradient")
	gradient.Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, COLORS.steelDark),
		ColorSequenceKeypoint.new(0.45, Color3.new(1, 1, 1)),
		ColorSequenceKeypoint.new(1, COLORS.steelDark),
	})
	gradient.Parent = parent
end

-- One long straight blade with a guard and a grip. Rotation turns it as a whole.
local function drawSword(rotation)
	local holder = part(art, {
		Name = "Sword",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromScale(0.075, 1.05),
		BackgroundTransparency = 1,
		Rotation = rotation,
	})
	local blade = part(holder, {
		Name = "Blade",
		Size = UDim2.fromScale(1, 0.72),
		BackgroundColor3 = COLORS.steel,
	})
	shine(blade)
	addStroke(blade, Color3.fromRGB(20, 20, 24), 2)
	-- Square-cut tip, like the sketch
	part(blade, {
		Name = "Tip",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.fromScale(1, 0),
		Size = UDim2.fromScale(0.5, 0.05),
		BackgroundColor3 = COLORS.background,
	})
	part(holder, {
		Name = "Guard",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0.72),
		Size = UDim2.fromScale(2.4, 0.03),
		BackgroundColor3 = COLORS.steelDark,
	})
	part(holder, {
		Name = "Grip",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0.75),
		Size = UDim2.fromScale(0.8, 0.25),
		BackgroundColor3 = COLORS.grip,
	})
end

-- A long shaft with a diamond-shaped head
local function drawSpear(rotation)
	local holder = part(art, {
		Name = "Spear",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromScale(0.05, 1.1),
		BackgroundTransparency = 1,
		Rotation = rotation,
	})
	part(holder, {
		Name = "Shaft",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.fromScale(0.5, 0.12),
		Size = UDim2.fromScale(0.6, 0.88),
		BackgroundColor3 = COLORS.grip,
	})
	local head = part(holder, {
		Name = "Head",
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.08),
		Size = UDim2.fromScale(2.2, 0.08),
		BackgroundColor3 = COLORS.steel,
		Rotation = 45,
	})
	local headAspect = Instance.new("UIAspectRatioConstraint")
	headAspect.AspectRatio = 1
	headAspect.Parent = head
	shine(head)
	addStroke(head, Color3.fromRGB(20, 20, 24), 2)
end

local function drawWeapon(name)
	art:ClearAllChildren()
	if name == "Spear" then
		drawSpear(-35)
		drawSpear(35)
	else
		drawSword(-38)
		drawSword(38)
	end
end

-- Stats panel on the right
local panel = part(screen, {
	Name = "StatsPanel",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.fromScale(1, 0.1),
	Size = UDim2.fromScale(0.34, 0.88),
	BackgroundColor3 = COLORS.panel,
})
addCorner(panel, 12)
addStroke(panel, COLORS.ink, 3)

label(panel, {
	Name = "Header",
	Position = UDim2.fromScale(0.08, 0.03),
	Size = UDim2.fromScale(0.84, 0.13),
	Text = "Stats",
})

part(panel, {
	Name = "Underline",
	Position = UDim2.fromScale(0.08, 0.165),
	Size = UDim2.new(0.84, 0, 0, 3),
	BackgroundColor3 = COLORS.ink,
})

local spLabel = label(panel, {
	Name = "SP",
	Position = UDim2.fromScale(0.08, 0.18),
	Size = UDim2.fromScale(0.84, 0.05),
	TextColor3 = COLORS.inkDim,
	Text = "SP: 0",
})

local statRows = {}

for index, statName in ipairs(STAT_ORDER) do
	local row = Instance.new("Frame")
	row.Name = statName
	row.Position = UDim2.fromScale(0.08, 0.25 + (index - 1) * 0.11)
	row.Size = UDim2.fromScale(0.84, 0.1)
	row.BackgroundTransparency = 1
	row.Parent = panel

	label(row, {
		Name = "Name",
		Size = UDim2.fromScale(0.75, 0.55),
		Text = statName,
		TextXAlignment = Enum.TextXAlignment.Left,
	})
	local valueLabel = label(row, {
		Name = "Value",
		AnchorPoint = Vector2.new(1, 0),
		Position = UDim2.fromScale(1, 0),
		Size = UDim2.fromScale(0.25, 0.55),
		Text = "0",
		TextXAlignment = Enum.TextXAlignment.Right,
	})
	local barBack = part(row, {
		Name = "Bar",
		Position = UDim2.fromScale(0, 0.68),
		Size = UDim2.fromScale(1, 0.22),
		BackgroundColor3 = COLORS.barBack,
	})
	addCorner(barBack, 4)
	local fill = part(barBack, {
		Name = "Fill",
		Size = UDim2.fromScale(0, 1),
		BackgroundColor3 = COLORS.bar,
	})
	addCorner(fill, 4)

	statRows[statName] = { value = valueLabel, fill = fill }
end

local upgradeButton = textButton(panel, "UpgradeButton", "upgrade — 3 SP", {
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.fromScale(0.5, 0.96),
	Size = UDim2.fromScale(0.84, 0.1),
	BackgroundColor3 = COLORS.upgrade,
})

---------------------------------------------------------------------------
-- Behaviour

local function refresh()
	local weapon = WEAPONS[current]
	local level = levels[weapon.name]

	weaponTitle.Text = string.upper(weapon.name)
	levelLabel.Text = level >= MAX_LEVEL and "Level MAX" or ("Level " .. level)
	spLabel.Text = "SP: " .. (player:GetAttribute("SP") or 0)

	for _, statName in ipairs(STAT_ORDER) do
		local value = statValue(weapon, statName)
		local row = statRows[statName]
		row.value.Text = tostring(value)
		TweenService:Create(row.fill, TweenInfo.new(0.25), {
			Size = UDim2.fromScale(math.clamp(value / BAR_MAX, 0, 1), 1),
		}):Play()
	end

	if level >= MAX_LEVEL then
		upgradeButton.Text = "fully upgraded"
	else
		upgradeButton.Text = "upgrade — " .. upgradeCost(level) .. " SP"
	end
end

swapButton.Activated:Connect(function()
	current = current % #WEAPONS + 1
	drawWeapon(WEAPONS[current].name)
	refresh()
end)

upgradeButton.Activated:Connect(function()
	local weapon = WEAPONS[current]
	local level = levels[weapon.name]
	local sp = player:GetAttribute("SP") or 0
	local cost = upgradeCost(level)

	if level >= MAX_LEVEL or sp < cost then
		-- Flash dark red so the player knows it didn't work
		upgradeButton.BackgroundColor3 = COLORS.denied
		TweenService:Create(upgradeButton, TweenInfo.new(0.4), { BackgroundColor3 = COLORS.upgrade }):Play()
		return
	end

	player:SetAttribute("SP", sp - cost)
	levels[weapon.name] = level + 1
	refresh()
end)

backButton.Activated:Connect(function()
	gui.Enabled = false
	local menu = playerGui:FindFirstChild("MainMenu")
	if menu then
		menu.Enabled = true
	end
end)

player:GetAttributeChangedSignal("SP"):Connect(refresh)

drawWeapon(WEAPONS[current].name)
refresh()
