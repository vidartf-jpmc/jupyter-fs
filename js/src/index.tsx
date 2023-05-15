/******************************************************************************
 *
 * Copyright (c) 2019, the jupyter-fs authors.
 *
 * This file is part of the jupyter-fs library, distributed under the terms of
 * the Apache License 2.0.  The full license can be found in the LICENSE file.
 *
 */

import { ILayoutRestorer, IRouter, JupyterFrontEnd, JupyterFrontEndPlugin } from "@jupyterlab/application";
import { IThemeManager, IWindowResolver } from "@jupyterlab/apputils";
import { IDocumentManager } from "@jupyterlab/docmanager";
import { ISettingRegistry } from "@jupyterlab/settingregistry";
import { IStatusBar } from '@jupyterlab/statusbar';
import { ITranslator } from '@jupyterlab/translation';
import { folderIcon, fileIcon } from "@jupyterlab/ui-components";
import { IDisposable } from "@lumino/disposable";
import * as React from "react";
import * as ReactDOM from "react-dom";

import { AskDialog, askRequired } from "./auth";
import { createCommands, idFromResource } from "./commands";
import { FSComm, IFSOptions, IFSResource } from "./filesystem";
import { FileUploadStatus } from "./progress";
import { ContentsProxy, TreeFinderSidebar } from "./treefinder";
import { ITreeFinderTracker } from "./tokens";

// tslint:disable: variable-name

const BROWSER_ID = "jupyter-fs:plugin";
export const browser: JupyterFrontEndPlugin<ITreeFinderTracker> = {
  autoStart: true,
  id: BROWSER_ID,
  requires: [
    IDocumentManager,
    JupyterFrontEnd.IPaths,
    IWindowResolver,
    ILayoutRestorer,
    IRouter,
    ISettingRegistry,
    IThemeManager,
  ],
  provides: ITreeFinderTracker,

  async activate(
    app: JupyterFrontEnd,
    manager: IDocumentManager,
    paths: JupyterFrontEnd.IPaths,
    resolver: IWindowResolver,
    restorer: ILayoutRestorer,
    router: IRouter,
    settingRegistry: ISettingRegistry,
    themeManager: IThemeManager,
  ): Promise<ITreeFinderTracker> {
    const comm = new FSComm();
    let widgetMap : {[key: string]: TreeFinderSidebar} = {};
    let commands: IDisposable | undefined;

    // Attempt to load application settings
    let settings: ISettingRegistry.ISettings | undefined;
    try {
      settings = await settingRegistry.load(BROWSER_ID);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to load settings for the jupyter-fs extension.\n${error}`);
    }

    let columns = settings?.composite.display_columns as (keyof ContentsProxy.IJupyterContentRow)[] ?? ['size'];

    const sharedSidebarProps: Omit<TreeFinderSidebar.ISidebarProps, "url"> = {
      app,
      manager,
      paths,
      resolver,
      restorer,
      router,
      columns, 
    };

    async function refreshWidgets({ resources, options }: {resources: IFSResource[]; options: IFSOptions}) {
      if (options.verbose) {
        // eslint-disable-next-line no-console
        console.info(`jupyter-fs frontend received resources:\n${JSON.stringify(resources)}`);
      }
      
      columns = settings?.composite.display_columns as (keyof ContentsProxy.IJupyterContentRow)[] ?? ['size'];
      sharedSidebarProps.columns = columns;

      // create the fs resource frontends (ie FileTree instances)
      for (const r of resources) {
        // make one composite disposable for all fs resource frontends
        const id = idFromResource(r);
        let w = widgetMap[id];
        if (!w || w.isDisposed) {
          const sidebarProps = {...sharedSidebarProps, url: r.url};
          const w = TreeFinderSidebar.sidebarFromResource(r, sidebarProps);
          widgetMap[id] = w;
        } else {
          w.treefinder.columns = columns;
        }
      }
      commands = createCommands(
        app,
        TreeFinderSidebar.tracker,
        TreeFinderSidebar.clipboard,
        resources,
        settings
      )
    }

    async function refresh() {
      // get user settings from json file
      let resources: IFSResource[] = settings!.composite.resources as any;
      const options: IFSOptions = settings!.composite.options as any;

      function cleanup(all=false) {
        if (commands) {
          commands.dispose();
          commands = undefined;
        }
        let keys = resources.map(idFromResource);
        for (let key of Object.keys(widgetMap)) {
          if (all || keys.indexOf(key) === -1) {
            widgetMap[key].dispose();
            delete widgetMap[key];
          }
        }
      }

      try {
        // send user specs to backend; await return containing resources
        // defined by user settings + resources defined by server config
        resources = await comm.initResourceRequest({
          resources,
          options: {
            ...options,
            _addServerside: true,
          },
        });

        if (askRequired(resources)) {
          // ask for url template values, if required
          const dialogElem = document.createElement("div");
          document.body.appendChild(dialogElem);

          const handleClose = () => {
            ReactDOM.unmountComponentAtNode(dialogElem);
            dialogElem.remove();
          };

          const handleSubmit = async (values: {[url: string]: {[key: string]: string}}) => {
            resources = await comm.initResourceRequest({
              resources: resources.map(r => ({ ...r, tokenDict: values[r.url] })),
              options,
            });
            cleanup();
            await refreshWidgets({ resources, options });
          };

          ReactDOM.render(
            <AskDialog
              handleClose={handleClose}
              handleSubmit={handleSubmit}
              options={options}
              resources={resources}
            />,
            dialogElem,
          );
        } else {
          // otherwise, just go ahead and refresh the widgets
          cleanup();
          await refreshWidgets({ options, resources });
        }
      } catch {
        cleanup(true);
      }
    }

    // initial setup when DOM attachment of custom elements is complete.
    void app.started.then(refresh);

    if (settings) {
      // rerun setup whenever relevant settings change
      settings.changed.connect(async () => {
        console.log('Settings has changed.. refreshing!');
        await refresh();
      });
    }

    // Inject lab icons
    const style = document.createElement("style");
    style.setAttribute('id', 'jupyter-fs-icon-inject');

    // Hackish, but needed since free-finder insists on pseudo elements for icons.
    function iconStyleContent(folderStr: string, fileStr: string) {
      // Note: We aren't able to style the hover/select colors with this.
      return `
      .jp-tree-finder {
        --tf-dir-icon: url('data:image/svg+xml,${encodeURIComponent(folderStr)}');
        --tf-file-icon: url('data:image/svg+xml,${encodeURIComponent(fileStr)}');
      }
      `
    }

    themeManager.themeChanged.connect(async () => {
      // Update SVG icon fills (since we put them in pseudo-elements we cannot style with CSS)
      const primary = getComputedStyle(document.documentElement).getPropertyValue('--jp-ui-font-color1');
      style.textContent = iconStyleContent(
        folderIcon.svgstr.replace(/fill="([^"]{0,7})"/, `fill="${primary}"`),
        fileIcon.svgstr.replace(/fill="([^"]{0,7})"/, `fill="${primary}"`)
      );

      // Refresh widgets in case font/border sizes etc have changed
      await Promise.all(Object.keys(widgetMap).map(
        key => widgetMap[key].treefinder.nodeInit()
      ));
    });

    style.textContent = iconStyleContent(folderIcon.svgstr, fileIcon.svgstr);

    document.head.appendChild(style);
    return { tracker: TreeFinderSidebar.tracker }
  }
}


const PROGRESS_ID = "jupyter-fs:progress"
export const progressStatus: JupyterFrontEndPlugin<void> = {
  autoStart: true,
  id: PROGRESS_ID,
  requires: [
    ITreeFinderTracker,
    ITranslator,
  ],
  optional: [IStatusBar],
  async activate(
    app: JupyterFrontEnd,
    tracker: ITreeFinderTracker,
    translator: ITranslator,
    statusbar: IStatusBar | null,
  ) {
    if (!statusbar) {
      return;
    }
    const item = new FileUploadStatus({
      tracker: tracker.tracker,
      translator
    });
    statusbar.registerStatusItem(
      PROGRESS_ID,
      {
        item,
        align: "middle",
        isActive: () => !!(item.model?.items.length),
        activeStateChanged: item.model.stateChanged,
      }
    );
  }
}

export default [
  browser,
  progressStatus,
];
