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
import { PythonGenerator } from 'blockly/python';
import { GeneratorContext } from './generator_context';
import { Block } from '../toolbox/items';
import { FunctionArg } from '../blocks/mrc_call_python_function';
import * as commonStorage from '../storage/common_storage';


const CLASS_NAME_PLACEHOLDER = '%class_name%';
const FULL_CLASS_NAME_PLACEHOLDER = '%full_class_name%';
const INSTANCE_LABEL_PLACEHOLDER = '%instance_label%';
const INSTANCE_VARIABLE_NAME_PLACEHOLDER = '%instance_var_name%';

// Extends the python generator to collect some information about functions and
// variables that have been defined so they can be used in other modules.

export class ExtendedPythonGenerator extends PythonGenerator {
  private workspace: Blockly.Workspace | null = null;
  private context: GeneratorContext | null = null;

  private classMethods: {[key: string]: string} = Object.create(null);

  constructor() {
    super('Python');
  }

  init(workspace: Blockly.Workspace){
    super.init(workspace);

    // super.init will have put all variables in this.definitions_['variables'] but we need to make
    // it contain only the developer variables.
    delete this.definitions_['variables'];
    const defvars = [];
    // Add developer variables (not created or named by the user).
    const devVarList = Blockly.Variables.allDeveloperVariables(workspace);
    for (let i = 0; i < devVarList.length; i++) {
      defvars.push(
        this.nameDB_!.getName(devVarList[i], Blockly.Names.DEVELOPER_VARIABLE_TYPE) + ' = None',
      );
    }
    this.definitions_['variables'] = defvars.join('\n');
  }

  /*
   * This is called from the python generator for the mrc_class_method_def for the
   * init method
   */
  defineClassVariables() : string {
    let variableDefinitions = '';

    if (this.context?.getHasMechanisms()) {
      variableDefinitions += this.INDENT + "self.mechanisms = []\n";
    }

    return variableDefinitions;
  }
  getVariableName(nameOrId: string): string {
    const varName = super.getVariableName(nameOrId);
    return "self." + varName;
  }
  setHasMechanism() : void{
    this.context?.setHasMechanism();
  }

  mrcWorkspaceToCode(workspace: Blockly.Workspace, context: GeneratorContext): string {
    this.workspace = workspace;
    this.context = context;
    this.context.clear();

    const code = super.workspaceToCode(workspace);

    this.workspace = workspace;
    this.context = null;
    return code;
  }

  /**
   * Add an import statement for a python module.
   */
  addImport(importModule: string): void {
    this.definitions_['import_' + importModule] = 'import ' + importModule;
  }

  /**
   * Add a class method definition.
   */
  addClassMethodDefinition(methodName: string, code: string): void {
    this.classMethods[methodName] = code;
  }

  finish(code: string): string {
    if (this.context && this.workspace) {
      const className = this.context.getClassName();
      const classParent = this.context.getClassParent();
      this.addImport(classParent);
      const classDef = 'class ' + className + '(' + classParent + '):\n';
      const classMethods = [];
      for (const name in this.classMethods) {
        classMethods.push(this.classMethods[name])
      }
      this.classMethods = Object.create(null);
      code = classDef + this.prefixLines(classMethods.join('\n\n'), this.INDENT);

      this.context.setExportedBlocks(this.produceExportedBlocks(this.workspace));
    }

    return super.finish(code);
  }

  private produceExportedBlocks(workspace: Blockly.Workspace): Block[] {
    // The exported blocks produced here have some values set to placeholders.
    // This is so blocks modules can be renamed and copied without having to change the
    // contents of the modules. The placeholders will be replaced with the actual module
    // name before they are added to the toolbox. See function replacePlaceholders below.

    const exportedBlocks = [];

    // Look at mrc_class_method_def blocks and make corresponding mrc_call_python_function blocks.
    workspace.getBlocksByType('mrc_class_method_def').forEach((classMethodDefBlock) => {
      if (!classMethodDefBlock.mrcCanBeCalledOutsideClass ||
          !classMethodDefBlock.isEnabled()) {
        return;
      }
      const args: FunctionArg[] = [];
      args.push({
        'name': INSTANCE_LABEL_PLACEHOLDER,
        'type': FULL_CLASS_NAME_PLACEHOLDER,
      });
      classMethodDefBlock.mrcParameters.forEach((param) => {
        args.push({
          'name': param.name,
          'type': param.type,
        });
      });
      const callFunctionBlock: Block = {
        'kind': 'block',
        'type': 'mrc_call_python_function',
        'extraState': {
          'functionKind': 'instance',
          'returnType': classMethodDefBlock.mrcPythonMethodName,
          'args': args,
          'importModule': '',
          'actualFunctionName': classMethodDefBlock.mrcPythonMethodName,
          'exportedFunction': true,
        },
        'fields': {
          'MODULE_OR_CLASS': FULL_CLASS_NAME_PLACEHOLDER,
          'FUNC': classMethodDefBlock.getFieldValue('NAME'),
        },
        'inputs': {
          'ARG0': {
            'block': {
              'type': 'variables_get',
              'fields': {
                'VAR': {
                  'name': INSTANCE_VARIABLE_NAME_PLACEHOLDER,
                }
              }
            }
          }
        }
      };
      exportedBlocks.push(callFunctionBlock);
    });

    const allVariables = workspace.getAllVariables();
    for (const variableModel of allVariables) {
      // Only variables that are used outside of functions are exported. (I'm not sure if this is
      // the right choice, since all blockly variables are global variables.)
      let exported = false;
      const variableUsesById = workspace.getVariableUsesById(variableModel.getId())
      if (variableUsesById.length === 0) {
        continue;
      }
      variableUsesById.forEach((block) => {
        if (block.type === 'variables_get' ||
          block.type === 'variables_set' ||
          block.type === 'math_change' ||
          block.type === 'text_append') {
          const rootBlock = block.getRootBlock();
          if (rootBlock.type !== 'procedures_defnoreturn' &&
            rootBlock.type !== 'procedures_defreturn') {
            exported = true;
          }
        }
      });
      if (exported) {
        const variableName = variableModel.name;
        const actualVariableName = super.getVariableName(variableModel.getId());
        const getPythonModuleVariableBlock = {
          'kind': 'block',
          'type': 'mrc_get_python_variable',
          'extraState': {
            'varKind': 'instance',
            'moduleOrClassName': FULL_CLASS_NAME_PLACEHOLDER,
            'importModule': '',
            'actualVariableName': actualVariableName,
            'selfLabel': INSTANCE_LABEL_PLACEHOLDER,
            'selfType': FULL_CLASS_NAME_PLACEHOLDER,
            'exportedVariable': true,
          },
          'fields': {
            'MODULE_OR_CLASS': FULL_CLASS_NAME_PLACEHOLDER,
            'VAR': variableName,
          },
          'inputs': {
            'SELF': {
              'block': {
                'type': 'variables_get',
                'fields': {
                  'VAR': {
                    'name': INSTANCE_VARIABLE_NAME_PLACEHOLDER,
                  }
                }
              }
            }
          }
        };
        exportedBlocks.push(getPythonModuleVariableBlock);
        const setPythonModuleVariableBlock = {
          'kind': 'block',
          'type': 'mrc_set_python_variable',
          'extraState': {
            'varKind': 'instance',
            'moduleOrClassName': FULL_CLASS_NAME_PLACEHOLDER,
            'importModule': '',
            'actualVariableName': actualVariableName,
            'selfLabel': INSTANCE_LABEL_PLACEHOLDER,
            'selfType': FULL_CLASS_NAME_PLACEHOLDER,
            'exportedVariable': true,
          },
          'fields': {
            'MODULE_OR_CLASS': FULL_CLASS_NAME_PLACEHOLDER,
            'VAR': variableName,
          },
          'inputs': {
            'SELF': {
              'block': {
                'type': 'variables_get',
                'fields': {
                  'VAR': {
                    'name': INSTANCE_VARIABLE_NAME_PLACEHOLDER,
                  }
                }
              }
            }
          }
        };
        exportedBlocks.push(setPythonModuleVariableBlock);
      }
    }
    return exportedBlocks;
  }
}

export const extendedPythonGenerator = new ExtendedPythonGenerator();

export function replacePlaceholders(modulePath: string, exportedBlocks: Block[]) {
  const moduleName = commonStorage.getModuleName(modulePath);
  const className = commonStorage.moduleNameToClassName(moduleName);
  const fullClassName = moduleName + '.' + className;
  const instanceLabel = className.charAt(0).toLowerCase() + className.slice(1);
  const instanceVariableName = instanceLabel;

  exportedBlocks.forEach((block) => {
    if (block.type === 'mrc_call_python_function') {
      if (block.extraState.args.length > 0 &&
          block.extraState.args[0].name === INSTANCE_LABEL_PLACEHOLDER) {
        block.extraState.args[0].name = instanceLabel;
      }
      if (block.extraState.args.length > 0 &&
          block.extraState.args[0].type === FULL_CLASS_NAME_PLACEHOLDER) {
        block.extraState.args[0].type = fullClassName;
      }
      if (block.fields.MODULE_OR_CLASS === FULL_CLASS_NAME_PLACEHOLDER) {
        block.fields.MODULE_OR_CLASS = fullClassName;
      }
      if (block.inputs.ARG0.block.type === 'variables_get' &&
          block.inputs.ARG0.block.fields.VAR.name === INSTANCE_VARIABLE_NAME_PLACEHOLDER) {
        block.inputs.ARG0.block.fields.VAR.name = instanceVariableName;
      }
    } else if (block.type === 'mrc_get_python_variable') {
      if (block.extraState.moduleOrClassName === FULL_CLASS_NAME_PLACEHOLDER) {
        block.extraState.moduleOrClassName = fullClassName;
      }
      if (block.extraState.selfLabel === INSTANCE_LABEL_PLACEHOLDER) {
        block.extraState.selfLabel = instanceLabel;
      }
      if (block.extraState.selfType === FULL_CLASS_NAME_PLACEHOLDER) {
        block.extraState.selfType = fullClassName;
      }
      if (block.fields.MODULE_OR_CLASS === FULL_CLASS_NAME_PLACEHOLDER) {
        block.fields.MODULE_OR_CLASS = fullClassName;
      }
      if (block.inputs.SELF.block.type === 'variables_get' &&
          block.inputs.SELF.block.fields.VAR.name === INSTANCE_VARIABLE_NAME_PLACEHOLDER) {
        block.inputs.SELF.block.fields.VAR.name = instanceVariableName;
      }
    } else if (block.type === 'mrc_set_python_variable') {
       if (block.extraState.moduleOrClassName === FULL_CLASS_NAME_PLACEHOLDER) {
        block.extraState.moduleOrClassName = fullClassName;
      }
      if (block.extraState.selfLabel === INSTANCE_LABEL_PLACEHOLDER) {
        block.extraState.selfLabel = instanceLabel;
      }
      if (block.extraState.selfType === FULL_CLASS_NAME_PLACEHOLDER) {
        block.extraState.selfType = fullClassName;
      }
      if (block.fields.MODULE_OR_CLASS === FULL_CLASS_NAME_PLACEHOLDER) {
        block.fields.MODULE_OR_CLASS = fullClassName;
      }
      if (block.inputs.SELF.block.type === 'variables_get' &&
          block.inputs.SELF.block.fields.VAR.name === INSTANCE_VARIABLE_NAME_PLACEHOLDER) {
        block.inputs.SELF.block.fields.VAR.name = instanceVariableName;
      }
    }
  });

  // HeyLiz begin
  const HeyLiz = JSON.stringify(exportedBlocks);
  if (HeyLiz.indexOf(CLASS_NAME_PLACEHOLDER) !== -1 ||
      HeyLiz.indexOf(FULL_CLASS_NAME_PLACEHOLDER) !== -1 ||
      HeyLiz.indexOf(INSTANCE_LABEL_PLACEHOLDER) !== -1 ||
      HeyLiz.indexOf(INSTANCE_VARIABLE_NAME_PLACEHOLDER) !== -1) {
    throw new Error('HeyLiz - A placeholder didn\'t get replaced: ' + HeyLiz);
  }
  // HeyLiz end
}
