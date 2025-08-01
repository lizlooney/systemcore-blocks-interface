/**
 * @license
 * Copyright 2025 Porpoiseful LLC
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
 * @fileoverview Creates an event that can be fired
 * @author alan@porpoiseful.com (Alan Smith)
 */
import * as Blockly from 'blockly';

import { MRC_STYLE_EVENTS } from '../themes/styles'
import { ExtendedPythonGenerator } from '../editor/extended_python_generator';
import { MUTATOR_BLOCK_NAME, PARAM_CONTAINER_BLOCK_NAME, MethodMutatorArgBlock } from './mrc_param_container'
import * as ChangeFramework from './utils/change_framework';
import { BLOCK_NAME as MRC_MECHANISM_COMPONENT_HOLDER } from './mrc_mechanism_component_holder';
import * as toolboxItems from '../toolbox/items';
import * as commonStorage from '../storage/common_storage';
import { renameMethodCallers, mutateMethodCallers } from './mrc_call_python_function'

export const BLOCK_NAME = 'mrc_event';
export const OUTPUT_NAME = 'mrc_event';

const FIELD_EVENT_NAME = 'NAME';

type Parameter = {
  name: string,
  type?: string,
};

type EventExtraState = {
  params?: Parameter[],
}

export type EventBlock = Blockly.Block & EventMixin & Blockly.BlockSvg;

interface EventMixin extends EventMixinType {
  mrcParameters: Parameter[],
}
type EventMixinType = typeof EVENT;

const EVENT = {
  /**
    * Block initialization.
    */
  init: function (this: EventBlock): void {
    this.setStyle(MRC_STYLE_EVENTS);
    this.appendDummyInput("TITLE")
      .appendField(new Blockly.FieldTextInput('my_event'), FIELD_EVENT_NAME);
    this.setPreviousStatement(true, OUTPUT_NAME);
    this.setNextStatement(true, OUTPUT_NAME);
    this.setMutator(new Blockly.icons.MutatorIcon([MUTATOR_BLOCK_NAME], this));
    ChangeFramework.registerCallback(BLOCK_NAME, [Blockly.Events.BLOCK_MOVE], this.onBlockChanged);
  },

  /**
    * Returns the state of this block as a JSON serializable object.
    */
  saveExtraState: function (this: EventBlock): EventExtraState {
    const extraState: EventExtraState = {
    };
    extraState.params = [];
    if (this.mrcParameters) {
      this.mrcParameters.forEach((arg) => {
        extraState.params!.push({
          'name': arg.name,
          'type': arg.type,
        });
      });
    }
    return extraState;
  },
  /**
  * Applies the given state to this block.
  */
  loadExtraState: function (this: EventBlock, extraState: EventExtraState): void {
    this.mrcParameters = [];

    if (extraState.params) {
      extraState.params.forEach((arg) => {
        this.mrcParameters.push({
          'name': arg.name,
          'type': arg.type,
        });
      });
    }
    this.mrcParameters = extraState.params ? extraState.params : [];
    this.updateBlock_();
  },
  /**
     * Update the block to reflect the newly loaded extra state.
     */
  updateBlock_: function (this: EventBlock): void {
    const name = this.getFieldValue(FIELD_EVENT_NAME);
    const input = this.getInput('TITLE');
    if (!input) {
      return;
    }
    input.removeField(FIELD_EVENT_NAME);

    const nameField = new Blockly.FieldTextInput(name);
    input.insertFieldAt(0, nameField, FIELD_EVENT_NAME);
    this.setMutator(new Blockly.icons.MutatorIcon([MUTATOR_BLOCK_NAME], this));
    nameField.setValidator(this.mrcNameFieldValidator.bind(this, nameField));

    this.mrcUpdateParams();
  },
  compose: function (this: EventBlock, containerBlock: any) {
    // Parameter list.
    this.mrcParameters = [];

    let paramBlock = containerBlock.getInputTargetBlock('STACK');
    while (paramBlock) {
      const param: Parameter = {
        name: paramBlock.getFieldValue('NAME'),
        type: ''
      }
      if (paramBlock.originalName) {
        // This is a mutator arg block, so we can get the original name.
        paramBlock.originalName = param.name;
      }
      this.mrcParameters.push(param);
      paramBlock =
        paramBlock.nextConnection && paramBlock.nextConnection.targetBlock();
    }
    this.mrcUpdateParams();
    mutateMethodCallers(this.workspace, this.id, this.getEvent());
  },
  decompose: function (this: EventBlock, workspace: Blockly.Workspace) {
    // This is a special sub-block that only gets created in the mutator UI.
    // It acts as our "top block"
    const topBlock = workspace.newBlock(PARAM_CONTAINER_BLOCK_NAME);
    (topBlock as Blockly.BlockSvg).initSvg();

    // Then we add one sub-block for each item in the list.
    let connection = topBlock!.getInput('STACK')!.connection;

    for (let i = 0; i < this.mrcParameters.length; i++) {
      let itemBlock = workspace.newBlock(MUTATOR_BLOCK_NAME);
      (itemBlock as Blockly.BlockSvg).initSvg();
      itemBlock.setFieldValue(this.mrcParameters[i].name, 'NAME');
      (itemBlock as MethodMutatorArgBlock).originalName = this.mrcParameters[i].name;

      connection!.connect(itemBlock.previousConnection!);
      connection = itemBlock.nextConnection;
    }
    return topBlock;
  },
  mrcUpdateParams: function (this: EventBlock) {
    if (this.mrcParameters.length > 0) {
      let input = this.getInput('TITLE');
      if (input) {
        this.removeParameterFields(input);
        this.mrcParameters.forEach((param) => {
          const paramName = 'PARAM_' + param.name;
          const field = new Blockly.FieldTextInput(param.name);
          field.EDITABLE = false;
          input.appendField(field, paramName);
        });
      }
    }
  },
  removeParameterFields: function (input: Blockly.Input) {
    const fieldsToRemove = input.fieldRow
      .filter(field => field.name?.startsWith('PARAM_'))
      .map(field => field.name!);

    fieldsToRemove.forEach(fieldName => {
      input.removeField(fieldName);
    });
  },
  mrcNameFieldValidator(this: EventBlock, nameField: Blockly.FieldTextInput, name: string): string {
    // Strip leading and trailing whitespace.
    name = name.trim();

    const legalName = name;
    const oldName = nameField.getValue();
    if (oldName && oldName !== name && oldName !== legalName) {
      // Rename any callers.
      renameMethodCallers(this.workspace, this.id, legalName);
    }
    return legalName;
  },
  onBlockChanged(block: Blockly.BlockSvg, blockEvent: Blockly.Events.BlockBase): void {
      const blockBlock = block as Blockly.Block;
  
      if (blockEvent.type === Blockly.Events.BLOCK_MOVE) {
        const parent = ChangeFramework.getParentOfType(block, MRC_MECHANISM_COMPONENT_HOLDER);
        
        if (parent) {
              // If it is, we allow it to stay.
              blockBlock.setWarningText(null);
              return;
            }
        // If we end up here it shouldn't be allowed
        block.unplug(true);
        blockBlock.setWarningText('Events can only go in the events section of the robot or mechanism');
      }
    },
    getEvent: function (this: EventBlock): commonStorage.Event {
      const event: commonStorage.Event = {
        blockId: this.id,
        name: this.getFieldValue(FIELD_EVENT_NAME),
        args: [],
      };
      this.mrcParameters.forEach(param => {
        event.args.push({
          name: param.name,
          type: param.type ? param.type : '',
        });
      });
      return event;
    },
}

export const setup = function () {
  Blockly.Blocks[BLOCK_NAME] = EVENT;
}

export const pythonFromBlock = function (
    _block: EventBlock,
    _generator: ExtendedPythonGenerator) {
  // TODO (Alan): What should this do here??
  return '';
}

// Functions used for creating blocks for the toolbox.

export function createCustomEventBlock(name: string): toolboxItems.Block {
  const extraState: EventExtraState = {
    params: [],
  };
  const fields: {[key: string]: any} = {};
  fields[FIELD_EVENT_NAME] = name;
  return new toolboxItems.Block(BLOCK_NAME, extraState, fields, null);
}
