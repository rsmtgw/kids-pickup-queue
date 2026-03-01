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
  IonButton,
  IonItem,
  IonLabel,
  IonAvatar,
  IonIcon,
  IonBadge,
  IonAlert,
  IonToast
} from '@ionic/react';
import { checkmarkCircle, carOutline, timeOutline } from 'ionicons/icons';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Child, QueueEntry } from '../types';
import './CheckIn.css';

const CheckIn: React.FC = () => {
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [checkedIn, setCheckedIn] = useState<string[]>([]);

  // Mock data - replace with actual API calls
  const mockChildren: Child[] = [
    {
      id: '1',
      firstName: 'Emma',
      lastName: 'Johnson',
      grade: '2nd Grade',
      parentIds: ['p1'],
      photoUrl: 'https://i.pravatar.cc/150?img=1'
    },
    {
      id: '2',
      firstName: 'Liam',
      lastName: 'Johnson',
      grade: 'Kindergarten',
      parentIds: ['p1'],
      photoUrl: 'https://i.pravatar.cc/150?img=2'
    }
  ];

  const handleCheckIn = () => {
    if (selectedChild) {
      // API call to check in
      setCheckedIn([...checkedIn, selectedChild]);
      setShowSuccess(true);
      setShowConfirm(false);
      setSelectedChild(null);
    }
  };

  const isCheckedIn = (childId: string) => checkedIn.includes(childId);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Check In</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="check-in-content">
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Check In</IonTitle>
          </IonToolbar>
        </IonHeader>

        <div className="check-in-container">
          <IonCard className="info-card">
            <IonCardContent>
              <div className="info-section">
                <IonIcon icon={carOutline} className="info-icon" />
                <div>
                  <h3>Arrival Instructions</h3>
                  <p>Check in when you arrive in the pickup line</p>
                </div>
              </div>
              <div className="info-section">
                <IonIcon icon={timeOutline} className="info-icon" />
                <div>
                  <h3>Estimated Wait</h3>
                  <p>Average wait time: 8 minutes</p>
                </div>
              </div>
            </IonCardContent>
          </IonCard>

          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Select Child to Check In</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              {mockChildren.map((child, index) => (
                <motion.div
                  key={child.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <IonCard 
                    className={`child-card ${selectedChild === child.id ? 'selected' : ''} ${isCheckedIn(child.id) ? 'checked-in' : ''}`}
                    button={!isCheckedIn(child.id)}
                    onClick={() => !isCheckedIn(child.id) && setSelectedChild(child.id)}
                  >
                    <IonItem lines="none">
                      <IonAvatar slot="start">
                        <img 
                          src={child.photoUrl || 'https://i.pravatar.cc/150'} 
                          alt={`${child.firstName} ${child.lastName}`} 
                        />
                      </IonAvatar>
                      <IonLabel>
                        <h2>{child.firstName} {child.lastName}</h2>
                        <p>{child.grade}</p>
                      </IonLabel>
                      {isCheckedIn(child.id) && (
                        <IonBadge color="success" slot="end">
                          <IonIcon icon={checkmarkCircle} /> Checked In
                        </IonBadge>
                      )}
                    </IonItem>
                  </IonCard>
                </motion.div>
              ))}
            </IonCardContent>
          </IonCard>

          {selectedChild && !isCheckedIn(selectedChild) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <IonButton 
                expand="block" 
                size="large" 
                className="check-in-button"
                onClick={() => setShowConfirm(true)}
              >
                Check In Now
              </IonButton>
            </motion.div>
          )}
        </div>

        <IonAlert
          isOpen={showConfirm}
          onDidDismiss={() => setShowConfirm(false)}
          header="Confirm Check In"
          message={`Check in ${mockChildren.find(c => c.id === selectedChild)?.firstName}?`}
          buttons={[
            {
              text: 'Cancel',
              role: 'cancel'
            },
            {
              text: 'Check In',
              handler: handleCheckIn
            }
          ]}
        />

        <IonToast
          isOpen={showSuccess}
          onDidDismiss={() => setShowSuccess(false)}
          message="Successfully checked in!"
          duration={3000}
          color="success"
          icon={checkmarkCircle}
        />
      </IonContent>
    </IonPage>
  );
};

export default CheckIn;
