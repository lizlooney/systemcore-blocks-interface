/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @author lizlooney@google.com (Liz Looney)
 */

import * as commonStorage from './common_storage';

// Functions for saving blocks modules to client side storage.

export type BooleanCallback = (success: boolean, error: string) => void;
export type StringCallback = (value: string | null, error: string) => void;
export type ModulesCallback = (modules: commonStorage.Workspace[] | null, error: string) => void;


const databaseName = 'systemcore-blocks-interface';
let db: IDBDatabase | null = null;

function openDatabase(callback: BooleanCallback): void {
  const openRequest = window.indexedDB.open(databaseName, 1);
  openRequest.onerror = (event: Event) => {
    console.log('IndexedDB open request failed:');
    console.log(openRequest.error);
    callback(false, 'openRequest error');
  };
  openRequest.onupgradeneeded = (event: Event) => {
    const db1 = openRequest.result;

    var stores = db1.objectStoreNames;

    if (!stores.contains('modules')) {
      // Create the object store for modules.
      db1.createObjectStore('modules', { keyPath: 'path' });
    }

    if (!stores.contains('entries')) {
      // Create an object store for key/value entries.
      db1.createObjectStore('entries', { keyPath: 'key' });
    }
  };
  openRequest.onsuccess = (event: Event) => {
    db = openRequest.result;
    callback(true, '');
  };
}

export function saveEntry(
    entryKey: string, entryValue: string,
    callback: BooleanCallback | null = null): void {
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        saveEntry(entryKey, entryValue, callback);
      } else {
        if (callback) {
          callback(false, 'Save entry failed. (' + errorReason + ')');
        }
      }
    });
    return;
  }
  const transaction = db.transaction(['entries'], 'readwrite');
  transaction.oncomplete = (event: Event) => {
    if (callback) {
      callback(true, '');
    }
  };
  const entriesObjectStore = transaction.objectStore('entries');
  const getRequest = entriesObjectStore.get(entryKey);
  getRequest.onerror = (event: Event) => {
    console.log('IndexedDB get request failed:');
    console.log(getRequest.error);
    if (callback) {
      callback(false, 'Save entry failed. (getRequest error)');
    }
  };
  getRequest.onsuccess = (event: Event) => {
    let value;
    if (getRequest.result === undefined) {
      value = Object.create(null);
      value.key = entryKey;
    } else {
      value = getRequest.result;
    }
    value.value = entryValue;
    const putRequest = entriesObjectStore.put(value);
    putRequest.onerror = (event: Event) => {
      console.log('IndexedDB put request failed:');
      console.log(putRequest.error);
      if (callback) {
        callback(false, 'Save entry failed. (putRequest error)');
      }
    };
  };
}

export function fetchEntry(entryKey: string, defaultValue: string, callback: StringCallback): void {
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        fetchEntry(entryKey, defaultValue, callback);
      } else {
        callback(null, 'Fetch entry failed. (' + errorReason + ')');
      }
    });
    return;
  }
  const getRequest = db.transaction(['entries'], 'readonly')
      .objectStore('entries').get(entryKey);
  getRequest.onerror = (event: Event) => {
    console.log('IndexedDB get request failed:');
    console.log(getRequest.error);
    callback(null, 'Fetch entry failed. (getRequest error)');
  };
  getRequest.onsuccess = (event: Event) => {
    if (getRequest.result === undefined) {
      // Entry does not exist.
      callback(defaultValue, '');
      return;
    }
    const value = getRequest.result;
    callback(value.value, '');
  };
}

export function listModules(callback: ModulesCallback): void {
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        listModules(callback);
      } else {
        callback(null, 'List modules failed. (' + errorReason + ')');
      }
    });
    return;
  }
  const workspaces: {[key: string]: commonStorage.Workspace} = {}; // key is workspace name, value is Workspace
  const opModes: {[key: string]: commonStorage.OpMode[]} = {}; // key is workspace name, value is list of OpModes
  const openCursorRequest = db.transaction(['modules'], 'readonly')
      .objectStore('modules')
      .openCursor();
  openCursorRequest.onerror = (event: Event) => {
    console.log('IndexedDB openCursor request failed:');
    console.log(openCursorRequest.error);
    callback(null, 'List modules failed. Could not open cursor.');
  };
  openCursorRequest.onsuccess = (event: Event) => {
    const cursor = openCursorRequest.result;
    if (cursor) {
      const value = cursor.value;
      const path = value.path;
      const module: commonStorage.Module = {
        modulePath: path,
        moduleType: value.type,
        workspaceName: commonStorage.getWorkspaceName(path),
        moduleName: commonStorage.getModuleName(path),
        dateModifiedMillis: value.dateModifiedMillis,
      }
      if (value.type === commonStorage.MODULE_TYPE_WORKSPACE) {
        const workspace: commonStorage.Workspace = {
          ...module,
          opModes: [],
          mechanisms: []
        };
        workspaces[workspace.workspaceName] = workspace;
        if (workspace.workspaceName in opModes) {
          workspace.opModes = opModes[workspace.workspaceName];
          delete opModes[workspace.workspaceName];
        } else {
          workspace.opModes = [];
        }
      } else if (value.type === commonStorage.MODULE_TYPE_OPMODE) {
        const opMode: commonStorage.OpMode = {
          ...module,
        };
        if (opMode.workspaceName in workspaces) {
          workspaces[opMode.workspaceName].opModes.push(opMode);
        } else if (opMode.workspaceName in opModes) {
          opModes[opMode.workspaceName].push(opMode);
        } else {
          opModes[opMode.workspaceName] = [opMode];
        }
      }
      cursor.continue();
    } else {
      const modules: commonStorage.Workspace[] = [];
      const sortedWorkspaceNames = Object.keys(workspaces).sort();
      sortedWorkspaceNames.forEach((workspaceName) => {
        modules.push(workspaces[workspaceName]);
      });
      callback(modules, '');
    }
  };
}

export function fetchModuleContent(
    modulePath: string,
    callback : (content: string | null, error: string) => void): void {
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        fetchModuleContent(modulePath, callback);
      } else {
        callback(null, 'Fetch module failed. (' + errorReason + ')');
      }
    });
    return;
  }
  const getRequest = db.transaction(['modules'], 'readonly')
      .objectStore('modules').get(modulePath);
  getRequest.onerror = (event: Event) => {
    console.log('IndexedDB get request failed:');
    console.log(getRequest.error);
    callback(null, 'Fetch module failed. (getRequest error)');
  };
  getRequest.onsuccess = (event: Event) => {
    if (getRequest.result === undefined) {
      // Module does not exist.
      callback(null, 'Module does not exist');
      return;
    }
    const value = getRequest.result;
    callback(value.content, '');
  };
}

export function createModule(
    moduleType: string, modulePath: string, moduleContent: string,
    callback: BooleanCallback): void {
  _saveModule(moduleType, modulePath, moduleContent, callback);
}

export function saveModule(
    modulePath: string, moduleContent: string,
    callback: BooleanCallback): void {
  _saveModule('', modulePath, moduleContent, callback);
}

function _saveModule(
    moduleType: string, modulePath: string, moduleContent: string,
    callback: BooleanCallback): void {
  // When creating a new module, moduleType must be truthy.
  // When saving an existing module, the moduleType must be falsy.
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        _saveModule(moduleType, modulePath, moduleContent, callback);
      } else {
        callback(false, 'Save module failed. (' + errorReason + ')');
      }
    });
    return;
  }
  const transaction = db.transaction(['modules'], 'readwrite');
  transaction.oncomplete = (event: Event) => {
    callback(true, '');
  };
  const modulesObjectStore = transaction.objectStore('modules');
  const getRequest = modulesObjectStore.get(modulePath);
  getRequest.onerror = (event: Event) => {
    console.log('IndexedDB get request failed:');
    console.log(getRequest.error);
    callback(false, 'Save module failed. (getRequest error)');
  };
  getRequest.onsuccess = (event: Event) => {
    let value;
    if (getRequest.result === undefined) {
      if (!moduleType) {
        // Since moduleType is not truthy, we are trying to save an existing module.
        // So it is unexpected that the getRequest.result is undefined.
        throw new Error('Unable to save module ' + modulePath);
      }
      value = Object.create(null);
      value.path = modulePath;
      value.type = moduleType;
    } else {
      if (moduleType) {
        // Since moduleType is truthy, we are trying to create an existing module.
        // So it is unexpected that the getRequest.result is not undefined.
        throw new Error('Unable to create module ' + modulePath);
      }
      value = getRequest.result;
    }
    value.content = moduleContent;
    value.dateModifiedMillis = Date.now();
    const putRequest = modulesObjectStore.put(value);
    putRequest.onerror = (event: Event) => {
      console.log('IndexedDB put request failed:');
      console.log(putRequest.error);
      callback(false, 'Save module failed. (putRequest error)');
    };
  };
}

export function renameWorkspace(
    oldWorkspaceName: string, newWorkspaceName: string,
    callback: BooleanCallback): void {
  _renameOrCopyWorkspace(oldWorkspaceName, newWorkspaceName, callback, false);
}

export function copyWorkspace(
    oldWorkspaceName: string, newWorkspaceName: string,
    callback: BooleanCallback): void {
  _renameOrCopyWorkspace(oldWorkspaceName, newWorkspaceName, callback, true);
}

export function _renameOrCopyWorkspace(
    oldWorkspaceName: string, newWorkspaceName: string,
    callback: BooleanCallback, copy: boolean): void {
  const errorMessage = copy
      ? 'Copy Workspace failed.'
      : 'Rename Workspace failed.'
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        _renameOrCopyWorkspace(oldWorkspaceName, newWorkspaceName, callback, copy);
      } else {
        callback(false, errorMessage + ' (' + errorReason + ')');
      }
    });
    return;
  }

  const transaction = db.transaction(['modules'], 'readwrite');
  transaction.oncomplete = (event: Event) => {
    callback(true, '');
  };
  const modulesObjectStore = transaction.objectStore('modules');
  // First get the list of modules in the workspace.
  const oldToNewModulePaths: {[key: string]: string} = {};
  const openCursorRequest = modulesObjectStore.openCursor();
  openCursorRequest.onerror = (event: Event) => {
    console.log('IndexedDB openCursor request failed:');
    console.log(openCursorRequest.error);
    callback(false, errorMessage + ' Could not open cursor.');
  };
  openCursorRequest.onsuccess = (event: Event) => {
    const cursor = openCursorRequest.result;
    if (cursor) {
      const value = cursor.value;
      const path = value.path;
      if (commonStorage.getWorkspaceName(path) === oldWorkspaceName) {
        let newPath;
        if (value.type === commonStorage.MODULE_TYPE_WORKSPACE) {
          newPath = commonStorage.makeModulePath(newWorkspaceName, newWorkspaceName);
        } else {
          const moduleName = commonStorage.getModuleName(path);
          newPath = commonStorage.makeModulePath(newWorkspaceName, moduleName);
        }
        oldToNewModulePaths[path] = newPath;
      }
      cursor.continue();
    } else {
      // Now rename the workspace for each of the modules.
      Object.entries(oldToNewModulePaths).forEach(([oldModulePath, newModulePath]) => {
        const getRequest = modulesObjectStore.get(oldModulePath);
        getRequest.onerror = (event: Event) => {
          console.log('IndexedDB get request failed:');
          console.log(getRequest.error);
          callback(false, errorMessage + ' (getRequest error)');
        };
        getRequest.onsuccess = (event: Event) => {
          if (getRequest.result === undefined) {
            callback(false, errorMessage + ' (workspace not found)');
            return;
          }
          const value = getRequest.result;
          value.path = newModulePath;
          value.dateModifiedMillis = Date.now();
          const putRequest = modulesObjectStore.put(value);
          putRequest.onerror = (event: Event) => {
            console.log('IndexedDB put request failed:');
            console.log(putRequest.error);
            callback(false, errorMessage + ' (putRequest error)');
          };
          putRequest.onsuccess = (event: Event) => {
            if (!copy) {
              const deleteRequest = modulesObjectStore.delete(oldModulePath);
              deleteRequest.onerror = (event: Event) => {
                console.log('IndexedDB delete request failed:');
                console.log(deleteRequest.error);
                callback(false, errorMessage + ' (deleteRequest error)');
              };
              deleteRequest.onsuccess = (event: Event) => {
              };
            }
          };
        };
      });
    }
  };
}

export function renameOpMode(
    workspaceName: string, oldOpModeName: string, newOpModeName: string,
    callback: BooleanCallback): void {
  _renameOrCopyOpMode(
      workspaceName, oldOpModeName, newOpModeName, callback, false);
}

export function copyOpMode(
    workspaceName: string, oldOpModeName: string, newOpModeName: string,
    callback: BooleanCallback): void {
  _renameOrCopyOpMode(
      workspaceName, oldOpModeName, newOpModeName, callback, true);
}

export function _renameOrCopyOpMode(
    workspaceName: string, oldOpModeName: string, newOpModeName: string,
    callback: BooleanCallback, copy: boolean): void {
  const errorMessage = copy
      ? 'Copy OpMode failed.'
      : 'Rename OpMode failed.'
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        _renameOrCopyOpMode(workspaceName, oldOpModeName, newOpModeName, callback, copy);
      } else {
        callback(false, errorMessage + '(' + errorReason + ')');
      }
    });
    return;
  }

  const transaction = db.transaction(['modules'], 'readwrite');
  transaction.oncomplete = (event: Event) => {
    callback(true, '');
  };
  const modulesObjectStore = transaction.objectStore('modules');
  const oldModulePath = commonStorage.makeModulePath(workspaceName, oldOpModeName);
  const newModulePath = commonStorage.makeModulePath(workspaceName, newOpModeName);
  const getRequest = modulesObjectStore.get(oldModulePath);
  getRequest.onerror = (event: Event) => {
    console.log('IndexedDB get request failed:');
    console.log(getRequest.error);
    callback(false, errorMessage + ' (getRequest error)');
  };
  getRequest.onsuccess = (event: Event) => {
    if (getRequest.result === undefined) {
      callback(false, errorMessage + ' (OpMode not found)');
      return;
    }
    const value = getRequest.result;
    value.path = newModulePath;
    value.dateModifiedMillis = Date.now();
    const putRequest = modulesObjectStore.put(value);
    putRequest.onerror = (event: Event) => {
      console.log('IndexedDB put request failed:');
      console.log(putRequest.error);
      callback(false, errorMessage + ' (putRequest error)');
    };
    putRequest.onsuccess = (event: Event) => {
      if (!copy) {
        const deleteRequest = modulesObjectStore.delete(oldModulePath);
        deleteRequest.onerror = (event: Event) => {
          console.log('IndexedDB delete request failed:');
          console.log(deleteRequest.error);
          callback(false, errorMessage + ' (deleteRequest error)');
        };
        deleteRequest.onsuccess = (event: Event) => {
        };
      }
    };
  };
}

export function deleteWorkspace(
    workspaceName: string,
    callback: BooleanCallback): void {
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        deleteWorkspace(workspaceName, callback);
      } else {
        callback(false, 'Delete workspace failed. (' + errorReason + ')');
      }
    });
    return;
  }

  const transaction = db.transaction(['modules'], 'readwrite');
  transaction.oncomplete = (event: Event) => {
    callback(true, '');
  };
  const modulesObjectStore = transaction.objectStore('modules');
  // First get the list of modulePaths in the workspace.
  const modulePaths: string[] = [];
  const openCursorRequest = modulesObjectStore.openCursor();
  openCursorRequest.onerror = (event: Event) => {
    console.log('IndexedDB openCursor request failed:');
    console.log(openCursorRequest.error);
    callback(false, 'Delete workspace failed. Could not open cursor.');
  };
  openCursorRequest.onsuccess = (event: Event) => {
    const cursor = openCursorRequest.result;
    if (cursor) {
      const value = cursor.value;
      const path = value.path;
      if (commonStorage.getWorkspaceName(path) === workspaceName) {
        modulePaths.push(path);
      }
      cursor.continue();
    } else {
      // Now delete each of the modules.
      modulePaths.forEach((modulePath) => {
        const deleteRequest = modulesObjectStore.delete(modulePath);
        deleteRequest.onerror = (event: Event) => {
          console.log('IndexedDB delete request failed:');
          console.log(deleteRequest.error);
          callback(false, 'Delete workspace failed. (deleteRequest error)');
        };
        deleteRequest.onsuccess = (event: Event) => {
        };
      });
    }
  };
}

export function deleteOpMode(
    opModePath: string,
    callback: BooleanCallback): void {
  if (!db) {
    openDatabase((success: boolean, errorReason: string) => {
      if (success) {
        deleteOpMode(opModePath, callback);
      } else {
        callback(false, 'Delete OpMode failed. (' + errorReason + ')');
      }
    });
    return;
  }

  const transaction = db.transaction(['modules'], 'readwrite');
  transaction.oncomplete = (event: Event) => {
    callback(true, '');
  };
  const modulesObjectStore = transaction.objectStore('modules');
  const deleteRequest = modulesObjectStore.delete(opModePath);
  deleteRequest.onerror = (event: Event) => {
    console.log('IndexedDB delete request failed:');
    console.log(deleteRequest.error);
    callback(false, 'Delete OpMode failed. (deleteRequest error)');
  };
  deleteRequest.onsuccess = (event: Event) => {
  };
}
