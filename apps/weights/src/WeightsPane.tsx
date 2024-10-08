import * as React from 'react';
import { observer } from 'mobx-react-lite';
//import debug from 'debug';
import { context } from './state';

import { Msg } from './Msg';
import { TabContainer } from './TabContainer';
import { TabSelector } from './TabSelector';
import { Stats } from './Stats';

import './WeightsPane.css';

export const WeightsPane = observer(function WeightsPane() {
  const _ctx = React.useContext(context);
  //const { state } = ctx;

  return (
    <div className='weightspane'>
      <Msg />
      <TabSelector />
      <Stats />
      <TabContainer />
    </div>
   );
});