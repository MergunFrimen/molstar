/**
 * Copyright (c) 2018-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { utf8ByteCount, utf8Write } from '../../../mol-io/common/utf8';
import { Structure } from '../../../mol-model/structure';
import { PluginStateObject as SO } from '../../../mol-plugin-state/objects';
import { PluginStateSnapshotManager } from '../../../mol-plugin-state/snapshots';
import { State, StateTransform, StateTree } from '../../../mol-state';
import { readFromFile } from '../../../mol-util/data-source';
import { getFormattedTime } from '../../../mol-util/date';
import { download } from '../../../mol-util/download';
import { objectForEach } from '../../../mol-util/object';
import { urlCombine } from '../../../mol-util/url';
import { zip } from '../../../mol-util/zip/zip';
import { PluginCommands } from '../../commands';
import { PluginConfig } from '../../config';
import { PluginContext } from '../../context';

export function registerDefault(ctx: PluginContext) {
    SyncBehaviors(ctx);
    SetCurrentObject(ctx);
    Update(ctx);
    ApplyAction(ctx);
    RemoveObject(ctx);
    ToggleExpanded(ctx);
    ToggleVisibility(ctx);
    Highlight(ctx);
    ClearHighlights(ctx);
    Snapshots(ctx);
}

export function SyncBehaviors(ctx: PluginContext) {
    ctx.events.state.object.created.subscribe(o => {
        if (!SO.isBehavior(o.obj)) return;
        o.obj.data.register(o.ref);
    });

    ctx.events.state.object.removed.subscribe(o => {
        if (!SO.isBehavior(o.obj)) return;
        o.obj.data.unregister();
    });

    ctx.events.state.object.updated.subscribe(o => {
        if (o.action === 'recreate') {
            if (o.oldObj && SO.isBehavior(o.oldObj)) o.oldObj.data.unregister();
            if (o.obj && SO.isBehavior(o.obj)) o.obj.data.register(o.ref);
        }
    });
}

export function SetCurrentObject(ctx: PluginContext) {
    PluginCommands.State.SetCurrentObject.subscribe(ctx, ({ state, ref }) => state.setCurrent(ref));
}

export function Update(ctx: PluginContext) {
    PluginCommands.State.Update.subscribe(ctx, ({ state, tree, options }) => ctx.runTask(state.updateTree(tree, options)));
}

export function ApplyAction(ctx: PluginContext) {
    PluginCommands.State.ApplyAction.subscribe(ctx, ({ state, action, ref }) => ctx.runTask(state.applyAction(action.action, action.params, ref)));
}

export function RemoveObject(ctx: PluginContext) {
    function remove(state: State, ref: string) {
        const tree = state.build().delete(ref);
        return ctx.runTask(state.updateTree(tree));
    }

    PluginCommands.State.RemoveObject.subscribe(ctx, ({ state, ref, removeParentGhosts }) => {
        if (removeParentGhosts) {
            const tree = state.tree;
            let curr = tree.transforms.get(ref);
            if (curr.parent === ref) return remove(state, ref);

            while (true) {
                const children = tree.children.get(curr.parent);
                if (curr.parent === curr.ref || children.size > 1) return remove(state, curr.ref);
                const parent = tree.transforms.get(curr.parent);
                // TODO: should this use "cell state" instead?
                if (!parent.state.isGhost) return remove(state, curr.ref);
                curr = parent;
            }
        } else {
            return remove(state, ref);
        }
    });
}

export function ToggleExpanded(ctx: PluginContext) {
    PluginCommands.State.ToggleExpanded.subscribe(ctx, ({ state, ref }) => state.updateCellState(ref, ({ isCollapsed }) => ({ isCollapsed: !isCollapsed })));
}

export function ToggleVisibility(ctx: PluginContext) {
    PluginCommands.State.ToggleVisibility.subscribe(ctx, ({ state, ref }) => setSubtreeVisibility(state, ref, !state.cells.get(ref)!.state.isHidden));
}

export function setSubtreeVisibility(state: State, root: StateTransform.Ref, value: boolean) {
    StateTree.doPreOrder(state.tree, state.transforms.get(root), { state, value }, setVisibilityVisitor);
}

function setVisibilityVisitor(t: StateTransform, tree: StateTree, ctx: { state: State, value: boolean }) {
    ctx.state.updateCellState(t.ref, { isHidden: ctx.value });
}

export function Highlight(ctx: PluginContext) {
    PluginCommands.Interactivity.Object.Highlight.subscribe(ctx, ({ state, ref }) => {
        ctx.managers.interactivity.lociHighlights.clearHighlights();

        const refs = typeof ref === 'string' ? [ref] : ref;
        for (const r of refs) {
            const cell = state.cells.get(r);
            if (!cell) continue;
            if (SO.Molecule.Structure.is(cell.obj)) {
                ctx.managers.interactivity.lociHighlights.highlight({ loci: Structure.Loci(cell.obj.data) }, false);
            } else if (cell && SO.isRepresentation3D(cell.obj)) {
                const { repr } = cell.obj.data;
                ctx.managers.interactivity.lociHighlights.highlight({ loci: repr.getLoci(), repr }, false);
            } else if (SO.Molecule.Structure.Selections.is(cell.obj)) {
                for (const entry of cell.obj.data) {
                    ctx.managers.interactivity.lociHighlights.highlight({ loci: entry.loci }, false);
                }
            }
        }

        // TODO: highlight volumes?
        // TODO: select structures of subtree?
    });
}

export function ClearHighlights(ctx: PluginContext) {
    PluginCommands.Interactivity.ClearHighlights.subscribe(ctx, () => {
        ctx.managers.interactivity.lociHighlights.clearHighlights();
    });
}

export function Snapshots(ctx: PluginContext) {
    ctx.config.set(PluginConfig.State.CurrentServer, ctx.config.get(PluginConfig.State.DefaultServer));

    PluginCommands.State.Snapshots.Clear.subscribe(ctx, () => {
        ctx.state.snapshots.clear();
    });

    PluginCommands.State.Snapshots.Remove.subscribe(ctx, ({ id }) => {
        ctx.state.snapshots.remove(id);
    });

    PluginCommands.State.Snapshots.Add.subscribe(ctx, ({ name, description, params }) => {
        const entry = PluginStateSnapshotManager.Entry(ctx.state.getSnapshot(params), { name, description });
        ctx.state.snapshots.add(entry);
    });

    PluginCommands.State.Snapshots.Replace.subscribe(ctx, ({ id, params }) => {
        ctx.state.snapshots.replace(id, ctx.state.getSnapshot(params));
    });

    PluginCommands.State.Snapshots.Move.subscribe(ctx, ({ id, dir }) => {
        ctx.state.snapshots.move(id, dir);
    });

    PluginCommands.State.Snapshots.Apply.subscribe(ctx, ({ id }) => {
        const snapshot = ctx.state.snapshots.setCurrent(id);
        if (!snapshot) return;
        return ctx.state.setSnapshot(snapshot);
    });

    PluginCommands.State.Snapshots.Upload.subscribe(ctx, ({ name, description, playOnLoad, serverUrl }) => {
        return fetch(urlCombine(serverUrl, `set?name=${encodeURIComponent(name || '')}&description=${encodeURIComponent(description || '')}`), {
            method: 'POST',
            mode: 'cors',
            referrer: 'no-referrer',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(ctx.state.snapshots.getRemoteSnapshot({ name, description, playOnLoad }))
        }) as any as Promise<void>;
    });

    PluginCommands.State.Snapshots.Fetch.subscribe(ctx, async ({ url }) => {
        const json = await ctx.runTask(ctx.fetch({ url, type: 'json' })); //  fetch(url, { referrer: 'no-referrer' });
        await ctx.state.snapshots.setRemoteSnapshot(json.data);
    });

    PluginCommands.State.Snapshots.DownloadToFile.subscribe(ctx, async ({ name, type }) => {
        const json = JSON.stringify(ctx.state.getSnapshot(), null, 2);
        name = `mol-star_state_${(name || getFormattedTime())}`;

        if (type === 'json') {
            const blob = new Blob([json], {type : 'application/json;charset=utf-8'});
            download(blob, `${name}.json`);
        } else {
            const state = new Uint8Array(utf8ByteCount(json));
            utf8Write(state, 0, json);

            const zipDataObj: { [k: string]: Uint8Array } = {
                'state.json': state
            };

            const assets: any[] = [];

            // TODO: there can be duplicate entries: check for this?
            for (const { asset, file } of ctx.managers.asset.assets) {
                assets.push([asset.id, asset]);
                zipDataObj[`assets/${asset.id}`] = new Uint8Array(await file.arrayBuffer());
            }

            if (assets.length > 0) {
                const index = JSON.stringify(assets, null, 2);
                const data = new Uint8Array(utf8ByteCount(index));
                utf8Write(data, 0, index);
                zipDataObj['assets.json'] = data;
            }

            const zipFile = zip(zipDataObj);

            const blob = new Blob([zipFile], {type : 'application/zip'});
            download(blob, `${name}.zip`);
        }
    });

    PluginCommands.State.Snapshots.OpenFile.subscribe(ctx, async ({ file }) => {
        try {
            if (file.name.toLowerCase().endsWith('json')) {
                const data = await ctx.runTask(readFromFile(file, 'string'));
                const snapshot = JSON.parse(data);
                return ctx.state.setSnapshot(snapshot);
            } else {
                const data = await ctx.runTask(readFromFile(file, 'zip'));
                const assets = Object.create(null);

                objectForEach(data, (v, k) => {
                    if (k === 'state.json' || k === 'assets.json') return;
                    const name = k.substring(k.indexOf('/') + 1);
                    assets[name] = new File([v], name);
                });
                const stateFile = new File([data['state.json']], 'state.json');
                const stateData = await ctx.runTask(readFromFile(stateFile, 'string'));

                if (data['assets.json']) {
                    const file = new File([data['assets.json']], 'assets.json');
                    const json = JSON.parse(await ctx.runTask(readFromFile(file, 'string')));

                    for (const [id, asset] of json) {
                        ctx.managers.asset.set(asset, assets[id]);
                    }
                }

                const snapshot = JSON.parse(stateData);
                return ctx.state.setSnapshot(snapshot);
            }
        } catch (e) {
            ctx.log.error(`Reading state: ${e}`);
        }
    });
}