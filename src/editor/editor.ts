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

import * as Blockly from 'blockly/core';

import { extendedPythonGenerator } from './extended_python_generator';
import { GeneratorContext } from './generator_context';
import * as commonStorage from '../storage/common_storage';
import * as callPythonFunction from '../blocks/mrc_call_python_function';
import * as eventHandler from '../blocks/mrc_event_handler';
import * as classMethodDef from '../blocks/mrc_class_method_def';
import * as mechanismComponentHolder from '../blocks/mrc_mechanism_component_holder';
//import { testAllBlocksInToolbox } from '../toolbox/toolbox_tests';
import { MethodsCategory } from '../toolbox/methods_category';
import { EventsCategory } from '../toolbox/event_category';
import { RobotEventsCategory } from '../toolbox/hardware_category';
import { getToolboxJSON } from '../toolbox/toolbox';

const EMPTY_TOOLBOX: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: 'categoryToolbox',
  contents: [],
};

export class Editor {
  private static workspaceIdToEditor: { [key: string]: Editor } = {};

  private blocklyWorkspace: Blockly.WorkspaceSvg;
  private generatorContext: GeneratorContext;
  private storage: commonStorage.Storage;
  private currentModule: commonStorage.Module | null = null;
  private modulePath: string = '';
  private robotPath: string = '';
  private moduleContentText: string = '';
  private robotContent: commonStorage.ModuleContent | null = null;
  private bindedOnChange: any = null;
  private toolbox: Blockly.utils.toolbox.ToolboxDefinition = EMPTY_TOOLBOX;

  constructor(blocklyWorkspace: Blockly.WorkspaceSvg, generatorContext: GeneratorContext, storage: commonStorage.Storage) {
    Editor.workspaceIdToEditor[blocklyWorkspace.id] = this;
    this.blocklyWorkspace = blocklyWorkspace;
    this.generatorContext = generatorContext;
    this.storage = storage;
    // Create the custom toolbox categories so they register their flyout callbacks.
    new MethodsCategory(blocklyWorkspace);
    new EventsCategory(blocklyWorkspace);
    new RobotEventsCategory(blocklyWorkspace);
  }

  private onChangeWhileLoading(event: Blockly.Events.Abstract) {
    if (event.type === Blockly.Events.FINISHED_LOADING) {
      // Remove the while-loading listener.
      this.blocklyWorkspace.removeChangeListener(this.bindedOnChange);

      // Add the after-loading listener.
      this.bindedOnChange = this.onChangeAfterLoading.bind(this);
      this.blocklyWorkspace.addChangeListener(this.bindedOnChange);
      return;
    }

    // Look at mrc_call_python_function blocks that might need updating if the
    // function definition has changed.
    if (event.type === Blockly.Events.BLOCK_CREATE) {
      const blockCreateEvent = event as Blockly.Events.BlockCreate;
      if (blockCreateEvent.ids) {
        blockCreateEvent.ids.forEach(id => {
          const block = this.blocklyWorkspace.getBlockById(id);
          if (block) {
            if (block.type == callPythonFunction.BLOCK_NAME) {
              (block as callPythonFunction.CallPythonFunctionBlock).onLoad();
            } else if (block.type == eventHandler.BLOCK_NAME) {
              (block as eventHandler.EventHandlerBlock).onLoad();
            }
          }
        });
      }
    }
  }

  private onChangeAfterLoading(event: Blockly.Events.Abstract) {
    if (event.isUiEvent) {
      // UI events are things like scrolling, zooming, etc.
      return;
    }
    if (this.blocklyWorkspace.isDragging()) {
      return;
    }
    // TODO(lizlooney): do we need to do anything here?
  }

  public async loadModuleBlocks(currentModule: commonStorage.Module | null) {
    this.generatorContext.setModule(currentModule);
    this.currentModule = currentModule;

    if (currentModule) {
      this.modulePath = currentModule.modulePath;
      this.robotPath = commonStorage.makeRobotPath(currentModule.projectName);
    } else {
      this.modulePath = '';
      this.robotPath = '';
    }
    this.moduleContentText = '';
    this.robotContent = null;
    this.clearBlocklyWorkspace();

    if (currentModule) {
      // Fetch the content for the current module and the robot.
      // TODO: Also fetch the content for the mechanisms?
      const promises: { [key: string]: Promise<string> } = {}; // key is module path, value is promise of module content.
      promises[this.modulePath] = this.storage.fetchModuleContentText(this.modulePath);
      if (this.robotPath !== this.modulePath) {
        // Also fetch the robot module content. It contains components, etc, that can be used in OpModes.
        promises[this.robotPath] = this.storage.fetchModuleContentText(this.robotPath)
      }

      const modulePathToContentText: { [key: string]: string } = {}; // key is module path, value is module content
      await Promise.all(
        Object.entries(promises).map(async ([modulePath, promise]) => {
          modulePathToContentText[modulePath] = await promise;
        })
      );
      this.moduleContentText = modulePathToContentText[this.modulePath];
      if (this.robotPath === this.modulePath) {
        this.robotContent = commonStorage.parseModuleContentText(this.moduleContentText);
      } else {
        this.robotContent = commonStorage.parseModuleContentText(modulePathToContentText[this.robotPath]);
      }
      this.loadBlocksIntoBlocklyWorkspace();
    }
  }

  private clearBlocklyWorkspace() {
    if (this.bindedOnChange) {
      this.blocklyWorkspace.removeChangeListener(this.bindedOnChange);
    }
    this.blocklyWorkspace.hideChaff();
    this.blocklyWorkspace.clear();
    this.blocklyWorkspace.scroll(0, 0);
    this.setToolbox(EMPTY_TOOLBOX);
  }

  private setToolbox(toolbox: Blockly.utils.toolbox.ToolboxDefinition) {
    if (toolbox != this.toolbox) {
      this.toolbox = toolbox;
      this.blocklyWorkspace.updateToolbox(toolbox);
      //    testAllBlocksInToolbox(toolbox);
    }
  }

  private loadBlocksIntoBlocklyWorkspace() {
    // Add the while-loading listener.
    this.bindedOnChange = this.onChangeWhileLoading.bind(this);
    this.blocklyWorkspace.addChangeListener(this.bindedOnChange);
    const moduleContent = commonStorage.parseModuleContentText(this.moduleContentText);
    Blockly.serialization.workspaces.load(moduleContent.getBlocks(), this.blocklyWorkspace);
  }

  public updateToolbox(shownPythonToolboxCategories: Set<string>): void {
    if (this.currentModule) {
      if (!this.robotContent) {
        // The Robot content hasn't been fetched yet. Try again in a bit.
        setTimeout(() => {
          this.updateToolbox(shownPythonToolboxCategories)
        }, 50);
        return;
      }
      this.setToolbox(
        getToolboxJSON(
          shownPythonToolboxCategories, this.currentModule));
    }
  }

  public isModified(): boolean {
    /*
    // This code is helpful for debugging issues where the editor says
    // 'Blocks have been modified!'.
    if (this.getModuleContentText() !== this.moduleContentText) {
      console.log('isModified will return true');
      console.log('this.getModuleContentText() is ' + this.getModuleContentText());
      console.log('this.moduleContentText is ' + this.moduleContentText);
    }
    */
    return this.getModuleContentText() !== this.moduleContentText;
  }

  public getCurrentModuleType(): string {
    if (this.currentModule) {
      return this.currentModule.moduleType;
    }
    return commonStorage.MODULE_TYPE_UNKNOWN;
  }

  private getModuleContentText(): string {
    if (!this.currentModule) {
      throw new Error('getModuleContentText: this.currentModule is null.');
    }

    // Generate python because some parts of components, events, and methods are affected.
    extendedPythonGenerator.mrcWorkspaceToCode(this.blocklyWorkspace, this.generatorContext);

    const blocks = Blockly.serialization.workspaces.save(this.blocklyWorkspace);
    const components: commonStorage.Component[] = this.getComponentsFromWorkspace();
    const events: commonStorage.Event[] = this.getEventsFromWorkspace();
    const methods: commonStorage.Method[] = (
        this.currentModule?.moduleType === commonStorage.MODULE_TYPE_ROBOT ||
        this.currentModule?.moduleType === commonStorage.MODULE_TYPE_MECHANISM)
        ? this.getMethodsForOutsideFromWorkspace()
        : [];
    return commonStorage.makeModuleContentText(
      this.currentModule, blocks, components, events, methods);
  }

  public getComponentsFromWorkspace(): commonStorage.Component[] {
    const components: commonStorage.Component[] = [];
    if (this.currentModule?.moduleType === commonStorage.MODULE_TYPE_ROBOT ||
        this.currentModule?.moduleType === commonStorage.MODULE_TYPE_MECHANISM) {
      mechanismComponentHolder.getComponents(this.blocklyWorkspace, components);
    }
    return components;
  }

  public getMethodsForWithinFromWorkspace(): commonStorage.Method[] {
    const methods: commonStorage.Method[] = [];
    classMethodDef.getMethodsForWithin(this.blocklyWorkspace, methods);
    return methods;
  }

  public getMethodsForOutsideFromWorkspace(): commonStorage.Method[] {
    const methods: commonStorage.Method[] = [];
    classMethodDef.getMethodsForOutside(this.blocklyWorkspace, methods);
    return methods;
  }

  public getMethodNamesAlreadyOverriddenInWorkspace(): string[] {
    const methodNamesAlreadyOverridden: string[] = [];
    classMethodDef.getMethodNamesAlreadyOverriddenInWorkspace(
        this.blocklyWorkspace, methodNamesAlreadyOverridden);
    return methodNamesAlreadyOverridden;
  }

  public getEventsFromWorkspace(): commonStorage.Event[] {
    const events: commonStorage.Event[] = [];
    if (this.currentModule?.moduleType === commonStorage.MODULE_TYPE_ROBOT ||
        this.currentModule?.moduleType === commonStorage.MODULE_TYPE_MECHANISM) {
      mechanismComponentHolder.getEvents(this.blocklyWorkspace, events);
    }
    return events;
  }

  public getEventHandlerNamesFromWorkspace(): string[] {
    const names: string[] = [];
    eventHandler.getEventHandlerNames(this.blocklyWorkspace, names);
    return names;
  }

  public async saveBlocks() {
    const moduleContentText = this.getModuleContentText();
    try {
      await this.storage.saveModule(this.modulePath, moduleContentText);
      this.moduleContentText = moduleContentText;
    } catch (e) {
      throw e;
    }
  }

  /**
   * Returns the components defined in the robot.
   */
  public getComponentsFromRobot(): commonStorage.Component[] {
    if (this.currentModule?.moduleType === commonStorage.MODULE_TYPE_ROBOT) {
      return this.getComponentsFromWorkspace();
    }
    if (!this.robotContent) {
      throw new Error('getComponentsFromRobot: this.robotContent is null.');
    }
    return this.robotContent.getComponents();
  }

  /**
   * Returns the events defined in the robot.
   */
  public getEventsFromRobot(): commonStorage.Event[] {
    if (this.currentModule?.moduleType === commonStorage.MODULE_TYPE_ROBOT) {
      return this.getEventsFromWorkspace();
    }
    if (!this.robotContent) {
      throw new Error('getEventsFromRobot: this.robotContent is null.');
    }
    return this.robotContent.getEvents();
  }

  /**
   * Returns the methods defined in the robot.
   */
  public getMethodsFromRobot(): commonStorage.Method[] {
    if (this.currentModule?.moduleType === commonStorage.MODULE_TYPE_ROBOT) {
      return this.getMethodsForWithinFromWorkspace();
    }
    if (!this.robotContent) {
      throw new Error('getMethodsFromRobot: this.robotContent is null.');
    }
    return this.robotContent.getMethods();
  }

  public static getEditorForBlocklyWorkspace(workspace: Blockly.Workspace): Editor | null {
    if (workspace.id in Editor.workspaceIdToEditor) {
      return Editor.workspaceIdToEditor[workspace.id];
    }

    // If the workspace id was not found, it might be because the workspace is associated with the
    // toolbox flyout, not a real workspace. In that case, use the first editor.
    const allEditors = Object.values(Editor.workspaceIdToEditor);
    if (allEditors.length) {
      return allEditors[0];
    }
    return null;
  }
}
