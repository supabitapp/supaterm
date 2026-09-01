# Group commands

`sp group` creates and manages ordered tab groups inside spaces. A group target is a `g:` ref, full UUID, or exact untyped title within the relevant space.

## Resolve an icon

Icon lookup reads the local filesystem and needs no running Supaterm app.

```bash
sp group icon
sp group icon ~/code/workspace
sp group icon --plain
sp group icon --json
```

The optional path is the directory to inspect. It defaults to the current directory.

The resolver first reads icon links from common HTML and root route files. It follows linked local web manifests, prefers SVG icons, then selects the largest declared square image.

If no declaration resolves, it checks these paths in order:

1. `favicon.svg`, `favicon.ico`, and `favicon.png`
2. The same favicon names under `public/`
3. Favicons and icons under `app/`, `src/`, and `src/app/`
4. `assets/icon.*`, `assets/logo.*`, then `.idea/icon.svg`

An icon must stay inside the directory and use AVIF, GIF, ICO, JPEG, PNG, SVG, or WebP. A symlink outside the directory does not resolve.

Human and plain output print the absolute icon path. JSON output returns `{"path":"..."}`. When no icon exists, human output says so, plain output is empty, and JSON returns `{"path":null}`.

## Create

`sp group new <title>` creates an empty group in the current space. Use `--in` to select another space.

```bash
sp group new Build
sp group new Deploy --color blue
sp group new Pinned --pin
sp group new Logs --in 2
sp group new Tests --in <space-uuid>
```

Colors are `neutral`, `red`, `orange`, `yellow`, `green`, `blue`, `pink`, and `purple`.

## Target groups

Group refs and UUIDs resolve globally. Untyped titles resolve only inside the ambient or explicitly targeted space and must be unique there. A typed token never falls back to a title.

When a target is omitted inside Supaterm, the group containing the current tab is used. An ungrouped current tab has no ambient group.

```bash
sp group collapse Build
sp group expand <group-uuid>
sp group pin
```

## Rename and recolor

```bash
sp group rename Deploy Build
sp group rename Deploy <group-uuid>
sp group color green Deploy
sp group color neutral <group-uuid>
```

The new title or color comes before the optional target.

## Pin and collapse

```bash
sp group pin Build
sp group unpin Build
sp group collapse Build
sp group expand Build
```

Pinning moves the whole group between the pinned and regular root lanes. Collapsing changes visibility without changing membership or tab order.

## Move

`sp group move [group] --index <index>` reorders a group within its current pinned or regular root lane. The index is 1-based.

```bash
sp group move --index 1
sp group move Deploy --index 2
sp group move <group-uuid> --index 1
```

## Ungroup

`sp group ungroup [group]` removes the group and moves its tabs to the space root.

```bash
sp group ungroup Build
sp group ungroup <group-uuid>
```

## Close

`sp group close [group]` closes every tab in the group, then removes it. It asks for confirmation unless `-y` or `--yes` is present.

```bash
sp group close Build
sp group close <group-uuid> --yes
```

Closing an empty group only removes the group. Closing the final tabs in a window closes that window.

## Output

Group mutations support the standard output flags:

```bash
sp group new Build --color blue --json
sp group color blue Build --plain
sp group collapse Build --quiet
```

Group creation JSON nests its canonical ID under `group.id`:

```json
{
  "group": {
    "id": "5A52445E-E42A-48B7-A5DD-C6C7C978B139"
  }
}
```
