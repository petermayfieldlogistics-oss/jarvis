--[[
	Beyond the Walls: detailed ODM blade model

	Put this ModuleScript in ReplicatedStorage and name it BladeModel.
	It builds a pair of blades out of parts, with the detail that shows up when
	the model spins: snap-off segment lines, a bright cutting edge, a dark spine,
	an angled tip, a collar, the handle box, grip wraps, a trigger and a pommel.

	Use it in your inventory script instead of the old blade:

		local BladeModel = require(game.ReplicatedStorage.BladeModel)
		local blades = BladeModel.pair()      -- or BladeModel.new() for one blade
		blades.Parent = yourViewportFrame     -- or the WorldModel inside it
		blades:PivotTo(CFrame.new(0, 0, 0))

	The blades point up (+Y) and the flat side faces the camera (+Z), so they
	look wide instead of edge-on. Spin the model as before with PivotTo.
]]

local BladeModel = {}

local STEEL = Color3.fromRGB(196, 202, 210)
local STEEL_DARK = Color3.fromRGB(110, 116, 126)
local EDGE = Color3.fromRGB(245, 248, 252)
local SCORE = Color3.fromRGB(60, 64, 72)
local HANDLE = Color3.fromRGB(58, 60, 66)
local HANDLE_DARK = Color3.fromRGB(32, 33, 37)
local WRAP = Color3.fromRGB(82, 60, 42)

local BLADE_LENGTH = 6
local BLADE_WIDTH = 0.42
local BLADE_THICKNESS = 0.05
local TIP_LENGTH = 0.55
local SEGMENTS = 8

local function makePart(model, name, size, cframe, color, props)
	local part = Instance.new(props and props.class or "Part")
	part.Name = name
	part.Anchored = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.CastShadow = false
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.Size = size
	part.CFrame = cframe
	part.Color = color
	part.Material = props and props.material or Enum.Material.SmoothPlastic
	part.Reflectance = props and props.reflectance or 0
	if props and props.shape then
		part.Shape = props.shape
	end
	part.Parent = model
	return part
end

-- One blade with its handle. The handle's centre is at the origin.
local function build(model, offset)
	local at = function(x, y, z)
		return offset * CFrame.new(x, y, z)
	end

	-- Handle: grip, wraps, box, trigger, pommel
	local grip = makePart(model, "Grip", Vector3.new(0.34, 1.5, 0.42), at(0, 0, 0), HANDLE)
	for i = 0, 3 do
		makePart(model, "Wrap", Vector3.new(0.38, 0.09, 0.46), at(0, -0.55 + i * 0.32, 0), WRAP)
	end
	makePart(model, "HandleBox", Vector3.new(0.5, 0.75, 0.62), at(0, 1.1, -0.04), HANDLE)
	makePart(model, "BoxPlate", Vector3.new(0.52, 0.5, 0.05), at(0, 1.1, 0.28), HANDLE_DARK)
	makePart(model, "Bolt", Vector3.new(0.08, 0.12, 0.12), at(0.27, 1.25, 0), STEEL_DARK, {
		shape = Enum.PartType.Cylinder,
		material = Enum.Material.Metal,
	})
	makePart(model, "Trigger", Vector3.new(0.12, 0.38, 0.2), at(0, 0.45, 0.3), HANDLE_DARK)
	makePart(model, "TriggerGuard", Vector3.new(0.14, 0.06, 0.42), at(0, 0.24, 0.2), HANDLE_DARK)
	makePart(model, "Pommel", Vector3.new(0.18, 0.46, 0.46), at(0, -0.84, 0) * CFrame.Angles(0, 0, math.rad(90)), STEEL_DARK, {
		shape = Enum.PartType.Cylinder,
		material = Enum.Material.Metal,
	})

	-- Collar where the blade locks into the handle
	local collarY = 1.1 + 0.375 + 0.1
	makePart(model, "Collar", Vector3.new(0.26, 0.2, 0.5), at(0, collarY, 0), STEEL_DARK, {
		material = Enum.Material.Metal,
	})

	-- Blade
	local bladeBottom = collarY + 0.1
	local bladeCentre = bladeBottom + BLADE_LENGTH / 2
	makePart(model, "Blade", Vector3.new(BLADE_THICKNESS, BLADE_LENGTH, BLADE_WIDTH), at(0, bladeCentre, 0), STEEL, {
		material = Enum.Material.Metal,
		reflectance = 0.25,
	})

	-- Bright cutting edge on the front, dark spine on the back
	makePart(model, "Edge", Vector3.new(BLADE_THICKNESS + 0.01, BLADE_LENGTH, 0.06),
		at(0, bladeCentre, BLADE_WIDTH / 2 - 0.03), EDGE, { reflectance = 0.4 })
	makePart(model, "Spine", Vector3.new(BLADE_THICKNESS + 0.02, BLADE_LENGTH, 0.05),
		at(0, bladeCentre, -BLADE_WIDTH / 2 + 0.025), STEEL_DARK)

	-- Slanted snap-off lines between the segments
	local segmentLength = BLADE_LENGTH / SEGMENTS
	for i = 1, SEGMENTS - 1 do
		makePart(model, "SegmentLine", Vector3.new(BLADE_THICKNESS + 0.012, 0.025, BLADE_WIDTH * 1.04),
			at(0, bladeBottom + i * segmentLength, 0) * CFrame.Angles(math.rad(-22), 0, 0), SCORE)
	end

	-- Angled tip: tall on the spine side, sloping down to the edge
	makePart(model, "Tip", Vector3.new(BLADE_THICKNESS, TIP_LENGTH, BLADE_WIDTH),
		at(0, bladeBottom + BLADE_LENGTH + TIP_LENGTH / 2, 0), STEEL, {
			class = "WedgePart",
			material = Enum.Material.Metal,
			reflectance = 0.25,
		})

	return grip
end

-- Halfway between the pommel and the tip, so the model spins around its middle
local PIVOT_Y = 3.7

-- One blade
function BladeModel.new()
	local model = Instance.new("Model")
	model.Name = "Blade"
	local grip = build(model, CFrame.new())
	model.PrimaryPart = grip
	model.WorldPivot = CFrame.new(0, PIVOT_Y, 0)
	return model
end

-- Two blades side by side, the way ODM blades are carried.
function BladeModel.pair()
	local model = Instance.new("Model")
	model.Name = "Blades"
	local left = build(model, CFrame.new(-0.45, 0, 0))
	build(model, CFrame.new(0.45, 0, 0))
	model.PrimaryPart = left
	model.WorldPivot = CFrame.new(0, PIVOT_Y, 0)
	return model
end

return BladeModel
