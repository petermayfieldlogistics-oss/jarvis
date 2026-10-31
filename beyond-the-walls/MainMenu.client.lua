--[[
	Beyond the Walls: main menu

	Put this LocalScript in StarterPlayer > StarterPlayerScripts.
	It builds the menu from the sketch: the title on the left, then
	Deploy, Inventory, Shop, Trading and Settings, each on its own ruled line.

	Hook up each button in the ACTIONS table at the bottom.
]]

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local COLORS = {
	background = Color3.fromRGB(14, 16, 20),
	ink = Color3.fromRGB(232, 228, 218),
	inkDim = Color3.fromRGB(150, 146, 138),
	line = Color3.fromRGB(90, 88, 84),
	highlight = Color3.fromRGB(196, 58, 44),
}

local TITLE_FONT = Enum.Font.GothamBlack
local BUTTON_FONT = Enum.Font.GothamBold

local BUTTONS = { "Deploy", "Inventory", "Shop", "Trading", "Settings" }

local gui = Instance.new("ScreenGui")
gui.Name = "MainMenu"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local backdrop = Instance.new("Frame")
backdrop.Name = "Backdrop"
backdrop.Size = UDim2.fromScale(1, 1)
backdrop.BackgroundColor3 = COLORS.background
backdrop.BorderSizePixel = 0
backdrop.Parent = gui

local shade = Instance.new("UIGradient")
shade.Rotation = 0
shade.Transparency = NumberSequence.new({
	NumberSequenceKeypoint.new(0, 0),
	NumberSequenceKeypoint.new(0.55, 0.15),
	NumberSequenceKeypoint.new(1, 0.6),
})
shade.Parent = backdrop

-- Left column that holds the title and the buttons
local column = Instance.new("Frame")
column.Name = "Column"
column.AnchorPoint = Vector2.new(0, 0.5)
column.Position = UDim2.new(0.07, 0, 0.5, 0)
column.Size = UDim2.fromScale(0.36, 0.8)
column.BackgroundTransparency = 1
column.Parent = backdrop

local sizeLimit = Instance.new("UISizeConstraint")
sizeLimit.MinSize = Vector2.new(260, 0)
sizeLimit.MaxSize = Vector2.new(520, math.huge)
sizeLimit.Parent = column

local layout = Instance.new("UIListLayout")
layout.FillDirection = Enum.FillDirection.Vertical
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Padding = UDim.new(0.012, 0)
layout.Parent = column

-- Title: BEYOND / the / WALLS
local function titleLine(text, heightScale, color, order)
	local label = Instance.new("TextLabel")
	label.Name = "Title_" .. text
	label.LayoutOrder = order
	label.Size = UDim2.fromScale(1, heightScale)
	label.BackgroundTransparency = 1
	label.Font = TITLE_FONT
	label.Text = text
	label.TextColor3 = color
	label.TextScaled = true
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Parent = column
	return label
end

titleLine("BEYOND", 0.15, COLORS.ink, 1)
titleLine("THE", 0.04, COLORS.inkDim, 2)
titleLine("WALLS", 0.15, COLORS.ink, 3)

local spacer = Instance.new("Frame")
spacer.Name = "Spacer"
spacer.LayoutOrder = 4
spacer.Size = UDim2.fromScale(1, 0.06)
spacer.BackgroundTransparency = 1
spacer.Parent = column

local buttons = {}

local function makeButton(name, order, isPrimary)
	local button = Instance.new("TextButton")
	button.Name = name .. "Button"
	button.LayoutOrder = order
	button.Size = UDim2.fromScale(1, 0.085)
	button.AutoButtonColor = false
	button.BackgroundColor3 = COLORS.highlight
	button.BackgroundTransparency = isPrimary and 0.15 or 1
	button.BorderSizePixel = 0
	button.Text = ""
	button.Parent = column

	local label = Instance.new("TextLabel")
	label.Name = "Label"
	label.AnchorPoint = Vector2.new(0, 0.5)
	label.Position = UDim2.new(0, 14, 0.5, 0)
	label.Size = UDim2.new(1, -28, 0.7, 0)
	label.BackgroundTransparency = 1
	label.Font = BUTTON_FONT
	label.Text = string.upper(name)
	label.TextColor3 = COLORS.ink
	label.TextScaled = true
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Parent = button

	-- The ruled line under each option, as in the sketch
	local rule = Instance.new("Frame")
	rule.Name = "Rule"
	rule.AnchorPoint = Vector2.new(0, 1)
	rule.Position = UDim2.fromScale(0, 1)
	rule.Size = UDim2.new(1, 0, 0, 2)
	rule.BackgroundColor3 = COLORS.line
	rule.BorderSizePixel = 0
	rule.Parent = button

	local restTransparency = button.BackgroundTransparency
	local hoverInfo = TweenInfo.new(0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

	button.MouseEnter:Connect(function()
		TweenService:Create(button, hoverInfo, { BackgroundTransparency = isPrimary and 0 or 0.6 }):Play()
		TweenService:Create(label, hoverInfo, { Position = UDim2.new(0, 24, 0.5, 0) }):Play()
	end)
	button.MouseLeave:Connect(function()
		TweenService:Create(button, hoverInfo, { BackgroundTransparency = restTransparency }):Play()
		TweenService:Create(label, hoverInfo, { Position = UDim2.new(0, 14, 0.5, 0) }):Play()
	end)

	buttons[name] = button
	return button
end

for index, name in ipairs(BUTTONS) do
	makeButton(name, 4 + index, index == 1)
end

local function hideMenu()
	gui.Enabled = false
end

-- What each button does. Replace the prints with your own game code.
local ACTIONS = {
	Deploy = function()
		print("Deploy pressed")
		hideMenu()
	end,
	Inventory = function()
		local inventory = playerGui:FindFirstChild("Inventory")
		if inventory then
			hideMenu()
			inventory.Enabled = true
		end
	end,
	Shop = function()
		print("Shop pressed")
	end,
	Trading = function()
		print("Trading pressed")
	end,
	Settings = function()
		print("Settings pressed")
	end,
}

for name, button in pairs(buttons) do
	button.Activated:Connect(function()
		local action = ACTIONS[name]
		if action then
			action()
		end
	end)
end
