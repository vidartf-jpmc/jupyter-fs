/******************************************************************************
 *
 * Copyright (c) 2019, the jupyter-fs authors.
 *
 * This file is part of the jupyter-fs library, distributed under the terms of
 * the Apache License 2.0.  The full license can be found in the LICENSE file.
 *
 */
import { ILayoutRestorer, IRouter, JupyterFrontEnd } from "@jupyterlab/application";
import {
  Dialog,
  IWindowResolver,
  showDialog,
  showErrorMessage,
  Toolbar,
  ToolbarButton,
  WidgetTracker, /*Clipboard, Dialog, IWindowResolver, showDialog*/
} from "@jupyterlab/apputils";
// import { PathExt, URLExt } from "@jupyterlab/coreutils";
import { IDocumentManager, isValidFileName /*renameFile*/ } from "@jupyterlab/docmanager";
// import { DocumentRegistry } from "@jupyterlab/docregistry";
import { Contents, ContentsManager } from "@jupyterlab/services";
import { ISettingRegistry } from "@jupyterlab/settingregistry";
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import {
  refreshIcon,
  newFolderIcon,
} from "@jupyterlab/ui-components";
// import JSZip from "jszip";
import { ArrayExt } from "@lumino/algorithm";
import { Message } from '@lumino/messaging';
import { PanelLayout, Widget } from "@lumino/widgets";
import { Content, ContentsModel, Format, IContentRow, Path, TreeFinderGridElement, TreeFinderPanelElement } from "tree-finder";

import { JupyterClipboard } from "./clipboard";
import { commandIDs, idFromResource } from "./commands";
import { revealPath } from "./contents_utils";
import { IFSResource } from "./filesystem";
import { fileTreeIcon } from "./icons";
import { promptRename } from "./utils";
import { Uploader, UploadButton } from "./upload";

export class ContentsProxy {
  constructor(contentsManager: ContentsManager, drive?: string) {
    this.contentsManager = contentsManager;
    this.drive = drive;
  }

  async get(path: string, options?: Contents.IFetchOptions) {
    path = ContentsProxy.toFullPath(path, this.drive);
    return ContentsProxy.toJupyterContentRow(await this.contentsManager.get(path, options), this.contentsManager, this.drive);
  }

  async save(path: string, options?: Partial<Contents.IModel>) {
    path = ContentsProxy.toFullPath(path, this.drive);
    return ContentsProxy.toJupyterContentRow(await this.contentsManager.save(path, options), this.contentsManager, this.drive);
  }

  async rename(path: string, newPath: string) {
    path = ContentsProxy.toFullPath(path, this.drive);
    newPath = ContentsProxy.toFullPath(newPath, this.drive);
    return ContentsProxy.toJupyterContentRow(await this.contentsManager.rename(path, newPath), this.contentsManager, this.drive);
  }

  async newUntitled(options: Contents.ICreateOptions) {
    options.path = options.path && ContentsProxy.toFullPath(options.path, this.drive);
    return ContentsProxy.toJupyterContentRow(await this.contentsManager.newUntitled(options), this.contentsManager, this.drive);
  }

  readonly contentsManager: ContentsManager;
  readonly drive?: string;
}

export namespace ContentsProxy {
  export interface IJupyterContentRow extends Omit<Contents.IModel, "path" | "content" | "type">, IContentRow {}

  export function toFullPath(path: string, drive?: string): string {

    if (!drive || path.startsWith(`${drive}:`)) {
      if (path.startsWith(`${drive}:/`)) {
        return path.replace(`${drive}:/`, `${drive}:`);
      }
      return path;
    } else if (path.startsWith(`${drive}/`)) {
      return [drive, path.slice(drive.length + 1)].join(":");
    } else {
      return [drive, path].join(":");
    };
  }

  export function toLocalPath(path: string): string {
    const [first, ...rest] = path.split("/");
    return [first.split(":").pop(), ...rest].join("/");
  }

  export function toJupyterContentRow(row: Contents.IModel, contentsManager: ContentsManager, drive?: string): IJupyterContentRow {
    const { path, type, ...rest } = row;

    const pathWithDrive = toFullPath(path, drive);
    const kind = type === "directory" ? "dir" : type;

    return {
      path: Path.toarray(pathWithDrive),
      kind,
      ...rest,
      ...(kind === "dir" ? {
        getChildren: async () => (await contentsManager.get(pathWithDrive, { content: true })).content.map((c: Contents.IModel) => toJupyterContentRow(c, contentsManager, drive)),
      }: {}),
    };
  }
}

export class TreeFinderTracker extends WidgetTracker<TreeFinderSidebar> {
  async add(finder: TreeFinderSidebar) {
    this._finders.set(finder.id, finder);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    finder.disposed.connect(this._onWidgetDisposed, this);

    return super.add(finder);
  }

  remove(finder: TreeFinderSidebar) {
    this._finders.delete(finder.id);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    finder.disposed.disconnect(this._onWidgetDisposed, this);
  }

  findByDrive(drive: string) {
    return this._finders.get(drive);
  }

  hasByDrive(drive: string) {
    return this._finders.has(drive);
  }

  private _onWidgetDisposed(finder: TreeFinderSidebar) {
    this.remove(finder);
  }

  private _finders = new Map<string, TreeFinderSidebar>();
}

export class TreeFinderWidget extends Widget {
  constructor({
    app,
    columns,
    rootPath = "",
    translator,
  }: TreeFinderWidget.IOptions) {
    const { commands, serviceManager: { contents } } = app;

    const node = document.createElement<ContentsProxy.IJupyterContentRow>("tree-finder-panel");
    super({ node });
    this.addClass("jp-tree-finder");

    this.contentsProxy = new ContentsProxy(contents, rootPath);
    
    this.translator = translator || nullTranslator;
    this._trans = this.translator.load('jupyterlab');
    
    this._columns = columns;
    this.rootPath = rootPath === "" ? rootPath : rootPath + ":";
    // CAREFUL: tree-finder currently REQUIRES the node to be added to the DOM before init can be called!
    this._ready = this.nodeInit().then(() => {
      this.uploader = new Uploader({
        contentsProxy: this.contentsProxy,
        model: this.model!,
      });
      this.model!.openSub.subscribe(rows => rows.forEach(row => {
        if (!row.getChildren) {
          void commands.execute("docmanager:open", { path: Path.fromarray(row.path) });
        }
      }));
    });
  }

  draw() {
    this.model?.requestDraw();
  }

  refresh() {
    this.model?.refreshSub.next();
  }

  async nodeInit() {
    await this.contentsProxy.get(this.rootPath).then(root => this.node.init({
      root,
      gridOptions: {
        columnFormatters: {
          last_modified: (x => Format.timeSince(x as any as Date)),
          size: (x => x && Format.bytesToHumanReadable(x)),
          writable: (x => x ? "✓" : "╳"),
        },
        doWindowResize: true,
        showFilter: true,
      },
      modelOptions: {
        columnNames: this.columns,
      },
    })).then(() => {
      const grid = this.node.querySelector<TreeFinderGridElement<ContentsProxy.IJupyterContentRow>>("tree-finder-grid");
      grid?.addStyleListener(() => {
        let lastSelectIdx = this.model?.selectedLast ? this.model?.contents.indexOf(this.model.selectedLast) : -1;
        for (let rowHeader of grid.querySelectorAll<HTMLTableCellElement>("tr > th")) {
          const nameElement = rowHeader.querySelector<HTMLSpanElement>("span.rt-group-name");
          // Ensure we can tab to all items
          nameElement?.setAttribute("tabindex", "0");
          // Ensure last selected element retains focus after redraw:
          if (nameElement && lastSelectIdx !== -1) {
            const meta = grid.getMeta(rowHeader);
            if (meta && meta.y === lastSelectIdx) {
              nameElement.focus();
              lastSelectIdx = -1;
            }
          }
        }
      });
    })
  }
  
  get columns(): (keyof ContentsProxy.IJupyterContentRow)[] {
    return this._columns;
  }
  set columns(value: (keyof ContentsProxy.IJupyterContentRow)[]) {
    if (ArrayExt.shallowEqual(this._columns, value)) {
      return;
    }
    this._columns = value;
    let m = this.model!;
    m.options = {
      ...m.options, 
      columnNames: this._columns, 
    };
    m.initColumns();
    this.nodeInit();

  }

  get ready(): Promise<void> {
    return this._ready;
  }
  

  get model(): ContentsModel<ContentsProxy.IJupyterContentRow> | undefined {
    return this.node.model;
  }

  get selection() {
    return this.model?.selection;
  }

  get selectionPathstrs() {
    return this.model?.selection.map(c => Path.fromarray(c.row.path));
  }
  
  /**
   * Handle the DOM events for the tree view.
   *
   * @param event - The DOM event sent to the widget.
   *
   * #### Notes
   * This method implements the DOM `EventListener` interface and is
   * called in response to events on the panel's DOM node. It should
   * not be called directly by user code.
   */
   handleEvent(event: Event): void {
    switch (event.type) {
      case 'keydown':
        this.evtKeydown(event as KeyboardEvent);
        break;
      case 'dragenter':
      case 'dragover':
        this.evtNativeDragOverEnter(event as DragEvent);
        break;
      case 'dragleave':
      case 'dragend':
        this.evtNativeDragLeaveEnd(event as DragEvent);
        break;
      case 'drop':
        this.evtNativeDrop(event as DragEvent);
        break;
      default:
        break;
    }
  }

  
  /**
   * A message handler invoked on an `'after-attach'` message.
   */
   protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    const node = this.node;
    node.addEventListener('keydown', this);
    node.addEventListener('dragenter', this);
    node.addEventListener('dragover', this);
    node.addEventListener('dragleave', this);
    node.addEventListener('dragend', this);
    node.addEventListener('drop', this);
  }

  /**
   * A message handler invoked on a `'before-detach'` message.
   */
  protected onBeforeDetach(msg: Message): void {
    super.onBeforeDetach(msg);
    const node = this.node;
    node.removeEventListener('keydown', this);
    node.removeEventListener('dragover', this);
    node.removeEventListener('dragover', this);
    node.removeEventListener('dragleave', this);
    node.removeEventListener('dragend', this);
    node.removeEventListener('drop', this);
  }

  private _findEventRowElement(event: DragEvent, selector: string): HTMLElement | undefined {
    let node = event.target as HTMLElement;
    while (node.parentElement && node.parentElement !== this.node) {
      if (node.matches(selector)) {
        return node;
      }
      node = node.parentElement;
    }
  }

  protected evtKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": 
        event.stopPropagation();
        event.preventDefault();
        const model = this.model!;
        let last = model.selectedLast;
        // tree-finder has a bug where it doesn't update selectedLast in `selectRange`, hacky work-around for now:
        const {range, pivot} = model.selectionModel as any as {range: string[], pivot: string};
        // once bug is fixed, this conditional should never be true:
        if (pivot && pivot === last?.pathstr && range && range.length >= 1) {
          // get the part of range that is furthest away from pivot:
          const paths = model.contents.map(c => c.pathstr);
          const pivotIdx = paths.indexOf(pivot);
          const rangeStartIdx = paths.indexOf(range[0]);
          const rangeEndIdx = paths.indexOf(range[range.length - 1]);
          if (pivotIdx < rangeStartIdx) {
            last = model.contents[rangeEndIdx];
          } else {
            last = model.contents[rangeStartIdx];
          }
        }
        let idx = last
          ? model.contents.indexOf(last)
          : event.key === "ArrowUp"
            ? model.contents.length - 1  // select last item
            : 0;  // select first item
        if (last) {
          idx = event.key === "ArrowUp" ? idx - 1 : idx + 1;
        }
        if (idx < 0 || idx >= model.contents.length) {
          return;  // Do nothing if going past the edge
        }
        const next = model.contents[idx];
        if (event.shiftKey) {
          model.selectionModel.selectRange(next, model.contents);
        } else {
          model.selectionModel.select(next);
        }
        void TreeFinderSidebar.scrollIntoView(this, next.pathstr);
        break;
    }
  }

  protected evtNativeDragOverEnter(event: DragEvent): void {
    let row = this._findEventRowElement(event, 'tree-finder-grid tr');
    if (row) {
      row.classList.add('jfs-mod-native-drop')
    }
    event.preventDefault();
  }

  protected evtNativeDragLeaveEnd(event: DragEvent) {
    let row = this._findEventRowElement(event, '.jfs-mod-native-drop');
    if (row) {
      row.classList.remove('jfs-mod-native-drop');
    }
  }
  
  /**
   * Handle the `drop` event for the widget.
   */
  protected evtNativeDrop(event: DragEvent): void {
    const row = this.node.querySelector('.jfs-mod-native-drop');
    if (row) {
      row.classList.remove('jfs-mod-native-drop');
    }
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }
    const length = event.dataTransfer?.items.length;
    if (!length) {
      return;
    }
    for (let i = 0; i < length; i++) {
      let entry = event.dataTransfer?.items[i].webkitGetAsEntry();
      if (entry?.isDirectory) {
        console.log('currently not supporting drag + drop for folders');
        void showDialog({
          title: this._trans.__('Error Uploading Folder'),
          body: this._trans.__(
            'Drag and Drop is currently not supported for folders'
          ),
          buttons: [Dialog.cancelButton({ label: this._trans.__('Close') })]
        });
      }
    }
    event.preventDefault();
    // Translate row element to contents row
    let target: Content<ContentsProxy.IJupyterContentRow> = this.model!.root;
    if (row) {
      const grid = this.node.querySelector('tree-finder-grid') as TreeFinderGridElement<ContentsProxy.IJupyterContentRow>;
      const metadata = grid.getMeta(row?.querySelector('th')!);
      if (metadata.y) {
        target = this.model!.contents[metadata.y];
      }
    }
    for (let i = 0; i < files.length; i++) {
      void this.uploader!.upload(files[i], target);
    }
  }

  contentsProxy: ContentsProxy;
  rootPath: string;
  private _columns: (keyof ContentsProxy.IJupyterContentRow)[];
  settings: ISettingRegistry.ISettings | undefined;
  uploader: Uploader | undefined;
  readonly node: TreeFinderPanelElement<ContentsProxy.IJupyterContentRow>;

  readonly translator: ITranslator;

  private _ready: Promise<void>;
  private _trans: TranslationBundle;
}

export namespace TreeFinderWidget {
  export interface IOptions {
    app: JupyterFrontEnd;
    columns: (keyof ContentsProxy.IJupyterContentRow)[];
    rootPath: string;
    
    translator?: ITranslator;
  }
}

export class TreeFinderSidebar extends Widget {
  constructor({
    app,
    columns,
    url,
    rootPath = "",
    caption = "TreeFinder",
    id = "jupyterlab-tree-finder",
  }: TreeFinderSidebar.IOptions) {
    super();
    this.id = id;
    this.url = url;
    this.title.icon = fileTreeIcon;
    this.title.caption = caption;
    this.title.closable = true;
    this.addClass("jp-tree-finder-sidebar");

    this.toolbar = new Toolbar();
    this.toolbar.addClass("jp-tree-finder-toolbar");

    this.treefinder = new TreeFinderWidget({app, rootPath, columns });

    this.layout = new PanelLayout();
    this.layout.addWidget(this.toolbar);
    this.layout.addWidget(this.treefinder);
  }

  restore() { // restore expansion prior to rebuild
    this.treefinder.ready.then(() => this.treefinder.refresh());
    // const array: Array<Promise<any>> = [];
    // Object.keys(this.controller).forEach(key => {
    //   if (this.controller[key].open && (key !== "")) {
    //     const promise = this.cm.get(this.basepath + key);
    //     promise.catch(res => {
    //       // eslint-disable-next-line no-console
    //       console.log(res);
    //     });
    //     array.push(promise);
    //   }
    // });
    // Promise.all(array).then(results => {
    //   for (const r in results) {
    //     const row_element = this.node.querySelector("[id='" + u_btoa(results[r].path.replace(this.basepath, "")) + "']");
    //     this.buildTableContents(results[r].content, 1 + results[r].path.split("/").length, row_element);
    //   }
    // }).catch(reasons => {
    //   // eslint-disable-next-line no-console
    //   console.log(reasons);
    // });
  }

  // async download(path: string, folder: boolean): Promise<any> {
  //   if (folder) {
  //     const zip = new JSZip();
  //     await this.wrapFolder(zip, path); // folder packing
  //     // generate and save zip, reset path
  //     path = PathExt.basename(path);
  //     writeZipFile(zip, path);
  //   } else {
  //     return this.cm.getDownloadUrl(this.basepath + path).then(url => {
  //       const element = document.createElement("a");
  //       document.body.appendChild(element);
  //       element.setAttribute("href", url);
  //       element.setAttribute("download", "");
  //       element.click();
  //       document.body.removeChild(element);
  //       return void 0;
  //     });
  //   }
  // }

  // async wrapFolder(zip: JSZip, path: string) {
  //   const base = this.cm.get(this.basepath + path);
  //   const next = base.then(async res => {
  //     if (res.type === "directory") {
  //       const new_folder = zip.folder(res.name);
  //       for (const c in res.content) {
  //         await this.wrapFolder(new_folder, res.content[c].path);
  //       }
  //     } else {
  //       zip.file(res.name, res.content);
  //     }
  //   });
  //   await next;
  // }

  protected onBeforeShow(msg: any): void {
    this.treefinder.refresh();
    this.treefinder.draw();
  }

  protected onResize(msg: any): void {
    this.treefinder.draw();
  }

  toolbar: Toolbar;
  treefinder: TreeFinderWidget;

  readonly layout: PanelLayout;
  readonly url: string;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace TreeFinderSidebar {
  const namespace = "jupyter-fs:TreeFinder";

  export const tracker = new TreeFinderTracker({ namespace });
  export const clipboard = new JupyterClipboard(tracker);

  export interface IOptions {
    app: JupyterFrontEnd;
    columns: (keyof ContentsProxy.IJupyterContentRow)[];
    url: string;

    rootPath?: string;
    caption?: string;
    id?: string;
    translator?: ITranslator;
  }

  export interface ISidebarProps extends IOptions {
    manager: IDocumentManager;
    paths: JupyterFrontEnd.IPaths;
    resolver: IWindowResolver;
    restorer: ILayoutRestorer;
    router: IRouter;

    side?: string;
  }

  export function sidebarFromResource(resource: IFSResource, props: TreeFinderSidebar.ISidebarProps): TreeFinderSidebar {
    return sidebar({
      ...props,
      rootPath: resource.drive,
      caption: `${resource.name}\nFile Tree`,
      id: idFromResource(resource),
      url: resource.url,
    });
  }

  export function sidebar({
    app,
    // manager,
    // paths,
    // resolver,
    // router,
    restorer,
    url,
    columns,

    rootPath = "",
    caption = "TreeFinder",
    id = "jupyterlab-tree-finder",
    side = "left",
  }: TreeFinderSidebar.ISidebarProps): TreeFinderSidebar {
    const widget = new TreeFinderSidebar({ app, rootPath, columns, caption, id, url });
    void widget.treefinder.ready.then(() => tracker.add(widget));
    restorer.add(widget, widget.id);
    app.shell.add(widget, side);

    const new_file_button = new ToolbarButton({
      icon: newFolderIcon,
      onClick: () => {
        app.commands.execute((commandIDs.create_folder));
      },
      tooltip: "New Folder",
    });
    const uploader_button = new UploadButton({uploader: widget.treefinder.ready.then(() => widget.treefinder.uploader!)});
    widget.treefinder.ready.then(() => {
      widget.treefinder.uploader!.uploadCompleted.connect(async (sender, args) => {
        // Do not select/scroll into view: Upload might be slow, so user might have moved on!
        // We do however want to expand the folder
        await revealPath(widget.treefinder.model!, args.path);
        await widget.treefinder.model!.flatten();
    });
    });
    const refresh_button = new ToolbarButton({
      icon: refreshIcon,
      onClick: () => {
        void app.commands.execute(commandIDs.refresh);
      },
      tooltip: "Refresh",
    });


    widget.toolbar.addItem("new file", new_file_button);
    widget.toolbar.addItem("upload", uploader_button);
    widget.toolbar.addItem("refresh", refresh_button);

    // // remove context highlight on context menu exit
    // document.ondblclick = () => {
    //   app.commands.execute((widget.commandIDs.set_context + ":" + widget.id), { path: "" });
    // };
    // widget.node.onclick = event => {
    //   app.commands.execute((widget.commandIDs.select + ":" + widget.id), { path: "" });
    // };

    // setInterval(() => {
    //   app.commands.execute(widget.commandIDs.refresh);
    // }, 10000);

    // return a disposable containing all disposables associated
    // with this widget, ending with the widget itself
    return widget;
  }

  export function doRename(widget: TreeFinderSidebar, oldContent: Content<ContentsProxy.IJupyterContentRow>): Promise<ContentsProxy.IJupyterContentRow> {
    const textNode = document.querySelector(".tf-mod-select .rt-tree-container .rt-group-name")!.firstChild as HTMLElement;
    const original = textNode!.textContent!.replace(/(.*)\/$/, "$1");
    const editNode = document.createElement("input");
    editNode.value = original;
    return promptRename(textNode, editNode, original).then(
      newName => {
        textNode.parentElement?.focus();
        if (!newName || newName === oldContent.name) {
          return oldContent.row;
        }
        if (!isValidFileName(newName)) {
          void showErrorMessage(
            "Rename Error",
            Error(newName +' is not a valid name. Names must have nonzero length, and cannot include "/", "\\", or ":"')
          );
          return oldContent.row;
        }
        let oldPath = oldContent.getPathAtDepth(1).join("/");
        const newPath = oldPath.slice(0, -1 * original.length) + newName;
        const suffix = textNode.textContent!.endsWith("/") ? "/" : "";
        const promise = widget.treefinder.contentsProxy.rename(oldPath + suffix, newPath + suffix);
        return promise
          .catch(error => {
            if (error !== "File not renamed") {
              void showErrorMessage(
                "Rename Error",
                error
              );
            }
            return oldContent.row;
          })
          .then(newContent => {
            textNode.textContent = newName + suffix;
            return newContent;
          });
      }
    );
  }

  /**
   * If a path entry is not in view, scroll it into view
   * 
   * @param treefinder The view
   * @param pathstr The entry to show
   */
  export async function scrollIntoView(treefinder: TreeFinderWidget, pathstr: string) {
    // tree-finder uses rxjs bits that don't allow you to await, so to ensure sync draw:
    const model = treefinder.model!;
    await model.flatten();
    const grid = treefinder.node.querySelector('tree-finder-grid') as TreeFinderGridElement<ContentsProxy.IJupyterContentRow>;
    await grid.draw();
    // Check if new row (selection) in view (if outside virtual window, it will fail):
    if (!document.querySelector(".tf-mod-select .rt-tree-container .rt-group-name")) {
      // We need to scroll the selection into view!
      const rowIdx = model.contents.findIndex(s => s.pathstr === pathstr);
      if (rowIdx !== -1) {
        // TODO: Should we perform a minimum scroll, or do we always want entry as close to the top of the view as possible?
        await grid.scrollToCell(0, rowIdx, 1, model.contents.length);
      }
    }
  }
}
