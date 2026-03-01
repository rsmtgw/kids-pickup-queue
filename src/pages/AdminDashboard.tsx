import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonItem,
  IonLabel,
  IonAvatar,
  IonButton,
  IonIcon,
  IonBadge,
  IonAlert,
  IonToast,
  IonList,
  IonSegment,
  IonSegmentButton,
  IonChip
} from '@ionic/react';
import { 
  checkmarkCircle, 
  closeCircle, 
  notificationsOutline, 
  statsChartOutline,
  timeOutline,
  carOutline
} from 'ionicons/icons';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { QueueEntry, Child, Parent } from '../types';
import './AdminDashboard.css';

const AdminDashboard: React.FC = () => {
  const [selectedSegment, setSelectedSegment] = useState<string>('active');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [showAlert, setShowAlert] = useState(false);
  const [alertAction, setAlertAction] = useState<'complete' | 'notify' | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Mock data
  const mockQueue = [
    {
      id: 'q1',
      childId: 'c1',
      parentId: 'p1',
      position: 1,
      checkInTime: new Date(Date.now() - 300000),
      status: 'ready' as const,
      child: {
        id: 'c1',
        firstName: 'Sophia',
        lastName: 'Williams',
        grade: '3rd Grade',
        parentIds: ['p1'],
        photoUrl: 'https://i.pravatar.cc/150?img=5'
      },
      parent: {
        id: 'p1',
        firstName: 'Mike',
        lastName: 'Williams',
        phone: '555-0101',
        email: 'mike@example.com',
        childIds: ['c1'],
        vehicleInfo: {
          make: 'Toyota',
          model: 'Camry',
          color: 'Blue',
          licensePlate: 'ABC123'
        }
      }
    },
    {
      id: 'q2',
      childId: 'c2',
      parentId: 'p2',
      position: 2,
      checkInTime: new Date(Date.now() - 240000),
      status: 'waiting' as const,
      child: {
        id: 'c2',
        firstName: 'Noah',
        lastName: 'Brown',
        grade: '1st Grade',
        parentIds: ['p2'],
        photoUrl: 'https://i.pravatar.cc/150?img=6'
      },
      parent: {
        id: 'p2',
        firstName: 'Sarah',
        lastName: 'Brown',
        phone: '555-0102',
        email: 'sarah@example.com',
        childIds: ['c2']
      }
    }
  ];

  const todayStats = {
    totalPickups: 45,
    averageWaitTime: 7.5,
    currentInQueue: mockQueue.length,
    peakTime: '3:15 PM'
  };

  const handleComplete = (entryId: string) => {
    setSelectedEntry(entryId);
    setAlertAction('complete');
    setShowAlert(true);
  };

  const handleNotify = (entryId: string) => {
    setSelectedEntry(entryId);
    setAlertAction('notify');
    setShowAlert(true);
  };

  const confirmAction = () => {
    if (alertAction === 'complete') {
      setToastMessage('Child marked as picked up successfully!');
    } else {
      setToastMessage('Notification sent to parent!');
    }
    setShowToast(true);
    setShowAlert(false);
    setSelectedEntry(null);
    setAlertAction(null);
  };

  const getSelectedEntry = () => {
    return mockQueue.find(e => e.id === selectedEntry);
  };

  const getTimeSinceCheckIn = (checkInTime: Date) => {
    const diff = Date.now() - checkInTime.getTime();
    const minutes = Math.floor(diff / 60000);
    return `${minutes} min`;
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Admin Dashboard</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="admin-content">
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Admin Dashboard</IonTitle>
          </IonToolbar>
        </IonHeader>

        <div className="admin-container">
          {/* Stats Overview */}
          <IonCard className="stats-overview-card">
            <IonCardHeader>
              <IonCardTitle>Today's Statistics</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <div className="stats-overview-grid">
                <div className="overview-stat">
                  <div className="overview-value">{todayStats.totalPickups}</div>
                  <div className="overview-label">Total Pickups</div>
                </div>
                <div className="overview-stat">
                  <div className="overview-value">{todayStats.averageWaitTime}</div>
                  <div className="overview-label">Avg Wait (min)</div>
                </div>
                <div className="overview-stat highlight">
                  <div className="overview-value">{todayStats.currentInQueue}</div>
                  <div className="overview-label">In Queue Now</div>
                </div>
                <div className="overview-stat">
                  <div className="overview-value">{todayStats.peakTime}</div>
                  <div className="overview-label">Peak Time</div>
                </div>
              </div>
            </IonCardContent>
          </IonCard>

          {/* Queue Management */}
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Queue Management</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonSegment 
                value={selectedSegment} 
                onIonChange={e => setSelectedSegment(e.detail.value as string)}
              >
                <IonSegmentButton value="active">
                  <IonLabel>Active ({mockQueue.length})</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="completed">
                  <IonLabel>Completed</IonLabel>
                </IonSegmentButton>
              </IonSegment>

              <IonList className="admin-queue-list">
                {mockQueue.map((entry, index) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <IonCard className={`admin-queue-card ${entry.status === 'ready' ? 'ready' : ''}`}>
                      <IonItem lines="none">
                        <div className="admin-position" slot="start">
                          {entry.position}
                        </div>
                        <IonAvatar slot="start">
                          <img 
                            src={entry.child.photoUrl || 'https://i.pravatar.cc/150'} 
                            alt={`${entry.child.firstName} ${entry.child.lastName}`}
                          />
                        </IonAvatar>
                        <IonLabel>
                          <h2 className="admin-child-name">
                            {entry.child.firstName} {entry.child.lastName}
                          </h2>
                          <p className="admin-child-grade">{entry.child.grade}</p>
                          <div className="admin-meta">
                            <IonChip className="admin-chip">
                              <IonIcon icon={timeOutline} />
                              <IonLabel>{getTimeSinceCheckIn(entry.checkInTime)}</IonLabel>
                            </IonChip>
                            {entry.parent.vehicleInfo && (
                              <IonChip className="admin-chip">
                                <IonIcon icon={carOutline} />
                                <IonLabel>
                                  {entry.parent.vehicleInfo.color} {entry.parent.vehicleInfo.make} - {entry.parent.vehicleInfo.licensePlate}
                                </IonLabel>
                              </IonChip>
                            )}
                          </div>
                          <p className="admin-parent-info">
                            Parent: {entry.parent.firstName} {entry.parent.lastName} - {entry.parent.phone}
                          </p>
                        </IonLabel>
                      </IonItem>
                      
                      <div className="admin-actions">
                        <IonButton 
                          size="small" 
                          fill="outline"
                          onClick={() => handleNotify(entry.id)}
                        >
                          <IonIcon slot="start" icon={notificationsOutline} />
                          Notify
                        </IonButton>
                        <IonButton 
                          size="small" 
                          color="success"
                          onClick={() => handleComplete(entry.id)}
                        >
                          <IonIcon slot="start" icon={checkmarkCircle} />
                          Complete Pickup
                        </IonButton>
                      </div>
                    </IonCard>
                  </motion.div>
                ))}
              </IonList>
            </IonCardContent>
          </IonCard>
        </div>

        <IonAlert
          isOpen={showAlert}
          onDidDismiss={() => setShowAlert(false)}
          header={alertAction === 'complete' ? 'Confirm Pickup Complete' : 'Send Notification'}
          message={
            alertAction === 'complete' 
              ? `Mark ${getSelectedEntry()?.child.firstName} ${getSelectedEntry()?.child.lastName} as picked up?`
              : `Send notification to ${getSelectedEntry()?.parent.firstName} ${getSelectedEntry()?.parent.lastName}?`
          }
          buttons={[
            {
              text: 'Cancel',
              role: 'cancel'
            },
            {
              text: 'Confirm',
              handler: confirmAction
            }
          ]}
        />

        <IonToast
          isOpen={showToast}
          onDidDismiss={() => setShowToast(false)}
          message={toastMessage}
          duration={3000}
          color="success"
        />
      </IonContent>
    </IonPage>
  );
};

export default AdminDashboard;
