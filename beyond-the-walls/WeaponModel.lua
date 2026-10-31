--[[
	Beyond the Walls: inventory weapon models from the "Aot gear" asset

	Put this ModuleScript in ReplicatedStorage and name it WeaponModel.
	Move the "Aot gear" model you inserted from the Toolbox into ReplicatedStorage
	too, so players' screens can see it.

	Use it in your inventory script:

		local WeaponModel = require(game.ReplicatedStorage.WeaponModel)
		local model = WeaponModel.get("Blades")   -- or "Spears"
		model.Parent = viewportFrame              -- or the WorldModel inside it
		model:PivotTo(CFrame.new(0, 0, 0))

	It finds the sword or spear inside "Aot gear" by name, copies it, removes any
	scripts from the copy, stands it upright and puts its pivot in the middle so
	it spins nicely. If it can't find one, it prints what is inside "Aot gear"
	to the Output window and falls back to the BladeModel module.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local WeaponModel = {}

local GEAR_NAME = "aot gear"

-- Words to look for in part and model names, best match first
local KEYWORDS = {
	Blades = { "blade", "sword" },
	Spears = { "thunder spear", "thunderspear", "spear" },
}

local function findGear()
	for _, place in ipairs({ ReplicatedStorage, workspace }) do
		for _, child in ipairs(place:GetDescendants()) do
			if string.lower(child.Name) == GEAR_NAME then
				return child
			end
		end
	end
	return nil
end

local function printTree(root)
	local lines = { 'Inside "' .. root:GetFullName() .. '":' }
	local function walk(instance, depth)
		for _, child in ipairs(instance:GetChildren()) do
			table.insert(lines, string.rep("  ", depth) .. child.Name .. " (" .. child.ClassName .. ")")
			if depth < 3 then
				walk(child, depth + 1)
			end
		end
	end
	walk(root, 1)
	print(table.concat(lines, "\n"))
end

-- A model or part counts if it has at least one visible part in it
local function hasParts(instance)
	if instance:IsA("BasePart") then
		return true
	end
	return instance:FindFirstChildWhichIsA("BasePart", true) ~= nil
end

local function findWeapon(gear, kind)
	for _, word in ipairs(KEYWORDS[kind] or {}) do
		-- Prefer a whole model over a single part with the same name
		for _, wantModel in ipairs({ true, false }) do
			for _, child in ipairs(gear:GetDescendants()) do
				local isModel = child:IsA("Model") or child:IsA("Folder") or child:IsA("Tool") or child:IsA("Accessory")
				if isModel == wantModel and string.find(string.lower(child.Name), word, 1, true) and hasParts(child) then
					return child
				end
			end
		end
	end
	return nil
end

-- Copy into a plain Model with no scripts, anchored, upright and centred
local function prepare(source)
	local model = Instance.new("Model")
	model.Name = source.Name

	local copy = source:Clone()
	if copy:IsA("BasePart") then
		copy.Parent = model
	else
		for _, child in ipairs(copy:GetChildren()) do
			child.Parent = model
		end
		copy:Destroy()
	end

	for _, descendant in ipairs(model:GetDescendants()) do
		if descendant:IsA("LuaSourceContainer") then
			descendant:Destroy()
		elseif descendant:IsA("BasePart") then
			descendant.Anchored = true
			descendant.CanCollide = false
			descendant.CanTouch = false
			descendant.CanQuery = false
			descendant.CastShadow = false
		elseif descendant:IsA("JointInstance") or descendant:IsA("WeldConstraint") then
			descendant:Destroy()
		end
	end

	-- Stand the longest side straight up
	local boxCFrame, size = model:GetBoundingBox()
	local upright = boxCFrame.Rotation
	if size.X >= size.Y and size.X >= size.Z then
		upright = upright * CFrame.Angles(0, 0, math.rad(90))
	elseif size.Z >= size.Y and size.Z >= size.X then
		upright = upright * CFrame.Angles(math.rad(90), 0, 0)
	end
	model.WorldPivot = CFrame.new(boxCFrame.Position) * upright
	model:PivotTo(CFrame.new())

	-- Re-centre after turning it
	local centre = model:GetBoundingBox()
	model.WorldPivot = CFrame.new(centre.Position)
	model:PivotTo(CFrame.new())

	return model
end

-- kind is "Blades" or "Spears"
function WeaponModel.get(kind)
	local gear = findGear()
	if not gear then
		warn('WeaponModel: no model named "Aot gear" in ReplicatedStorage or Workspace. Move it into ReplicatedStorage.')
	else
		local weapon = findWeapon(gear, kind)
		if weapon then
			return prepare(weapon)
		end
		warn("WeaponModel: couldn't find the " .. kind .. ' inside "Aot gear". Here is what it contains:')
		printTree(gear)
	end

	local fallback = ReplicatedStorage:FindFirstChild("BladeModel")
	if fallback then
		return require(fallback).pair()
	end
	return Instance.new("Model")
end

return WeaponModel
