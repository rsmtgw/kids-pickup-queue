import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { peopleOutline, listOutline, personOutline, settingsOutline, carOutline, schoolOutline, scanOutline, locationOutline, documentTextOutline, homeOutline, analyticsOutline, mapOutline } from 'ionicons/icons';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Theme variables */
import './theme/variables.css';
import './theme/animations.css';

/* Pages */
import QueueDisplay from './pages/QueueDisplay';
import CheckIn from './pages/CheckIn';
import AdminDashboard from './pages/AdminDashboard';
import Profile from './pages/Profile';
import PickupVisualization from './pages/PickupVisualization';
import KidsManagement from './pages/KidsManagement';
import ScanStation from './pages/ScanStation';
import PillarManager from './pages/PillarManager';
import PickupReport from './pages/PickupReport';
import ParentPortal from './pages/ParentPortal';
import ParentAdmin from './pages/ParentAdmin';
import ParentAddressManager from './pages/ParentAddressManager';
import DeveloperTab from './pages/DeveloperTab';

setupIonicReact();

const App: React.FC = () => {
  return (
    <IonApp>
      <IonReactRouter>
        <IonTabs>
          <IonRouterOutlet>
            <Route exact path="/queue">
              <QueueDisplay />
            </Route>
            <Route exact path="/checkin">
              <CheckIn />
            </Route>
            <Route exact path="/visualization">
              <PickupVisualization />
            </Route>
            <Route exact path="/kids">
              <KidsManagement />
            </Route>
            <Route exact path="/scan">
              <ScanStation />
            </Route>
            <Route exact path="/pillar">
              <PillarManager />
            </Route>
            <Route exact path="/admin">
              <AdminDashboard />
            </Route>
            <Route exact path="/profile">
              <Profile />
            </Route>
            <Route exact path="/report">
              <PickupReport />
            </Route>
            <Route exact path="/parent">
              <ParentPortal />
            </Route>
            <Route exact path="/parent-admin">
              <ParentAdmin />
            </Route>
            <Route exact path="/parent-addresses">
              <ParentAddressManager />
            </Route>
            <Route exact path="/developer">
              <DeveloperTab />
            </Route>
            <Route exact path="/">
              <Redirect to="/visualization" />
            </Route>
          </IonRouterOutlet>
          <IonTabBar slot="bottom">
            <IonTabButton tab="visualization" href="/visualization">
              <IonIcon aria-hidden="true" icon={carOutline} />
              <IonLabel>Pickup</IonLabel>
            </IonTabButton>
            <IonTabButton tab="queue" href="/queue">
              <IonIcon aria-hidden="true" icon={listOutline} />
              <IonLabel>Queue</IonLabel>
            </IonTabButton>
            <IonTabButton tab="checkin" href="/checkin">
              <IonIcon aria-hidden="true" icon={peopleOutline} />
              <IonLabel>Check In</IonLabel>
            </IonTabButton>
            <IonTabButton tab="kids" href="/kids">
              <IonIcon aria-hidden="true" icon={schoolOutline} />
              <IonLabel>Kids</IonLabel>
            </IonTabButton>
            <IonTabButton tab="scan" href="/scan">
              <IonIcon aria-hidden="true" icon={scanOutline} />
              <IonLabel>Scan</IonLabel>
            </IonTabButton>
            <IonTabButton tab="pillar" href="/pillar">
              <IonIcon aria-hidden="true" icon={locationOutline} />
              <IonLabel>Pillar</IonLabel>
            </IonTabButton>
            <IonTabButton tab="admin" href="/admin">
              <IonIcon aria-hidden="true" icon={settingsOutline} />
              <IonLabel>Admin</IonLabel>
            </IonTabButton>
            <IonTabButton tab="report" href="/report">
              <IonIcon aria-hidden="true" icon={documentTextOutline} />
              <IonLabel>Report</IonLabel>
            </IonTabButton>
            <IonTabButton tab="parent" href="/parent">
              <IonIcon aria-hidden="true" icon={homeOutline} />
              <IonLabel>Parent</IonLabel>
            </IonTabButton>
            <IonTabButton tab="parent-admin" href="/parent-admin">
              <IonIcon aria-hidden="true" icon={analyticsOutline} />
              <IonLabel>P-Admin</IonLabel>
            </IonTabButton>
            <IonTabButton tab="parent-addresses" href="/parent-addresses">
              <IonIcon aria-hidden="true" icon={mapOutline} />
              <IonLabel>Addresses</IonLabel>
            </IonTabButton>
            <IonTabButton tab="profile" href="/profile">
              <IonIcon aria-hidden="true" icon={personOutline} />
              <IonLabel>Profile</IonLabel>
            </IonTabButton>
            <IonTabButton tab="developer" href="/developer">
              <IonIcon aria-hidden="true" icon={settingsOutline} />
              <IonLabel>Developer</IonLabel>
            </IonTabButton>
          </IonTabBar>
        </IonTabs>
      </IonReactRouter>
    </IonApp>
  );
};

export default App;
