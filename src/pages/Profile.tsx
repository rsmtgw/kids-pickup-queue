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
  IonInput,
  IonButton,
  IonIcon,
  IonList,
  IonListHeader,
  IonToggle
} from '@ionic/react';
import { 
  personOutline, 
  mailOutline, 
  callOutline, 
  carOutline,
  notificationsOutline,
  logOutOutline
} from 'ionicons/icons';
import { useState } from 'react';
import { Child } from '../types';
import './Profile.css';

const Profile: React.FC = () => {
  const [notifications, setNotifications] = useState(true);
  const [smsAlerts, setSmsAlerts] = useState(true);

  // Mock data
  const mockParent = {
    id: 'p1',
    firstName: 'John',
    lastName: 'Johnson',
    email: 'john@example.com',
    phone: '555-0103',
    photoUrl: 'https://i.pravatar.cc/300?img=3',
    vehicleInfo: {
      make: 'Honda',
      model: 'CR-V',
      color: 'Silver',
      licensePlate: 'XYZ789'
    }
  };

  const mockChildren: Child[] = [
    {
      id: 'c1',
      firstName: 'Emma',
      lastName: 'Johnson',
      grade: '2nd Grade',
      parentIds: ['p1'],
      photoUrl: 'https://i.pravatar.cc/150?img=1'
    },
    {
      id: 'c2',
      firstName: 'Liam',
      lastName: 'Johnson',
      grade: 'Kindergarten',
      parentIds: ['p1'],
      photoUrl: 'https://i.pravatar.cc/150?img=2'
    }
  ];

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Profile</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="profile-content">
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Profile</IonTitle>
          </IonToolbar>
        </IonHeader>

        <div className="profile-container">
          {/* User Info */}
          <IonCard className="profile-header-card">
            <IonCardContent>
              <div className="profile-header">
                <IonAvatar className="profile-avatar">
                  <img src={mockParent.photoUrl} alt={`${mockParent.firstName} ${mockParent.lastName}`} />
                </IonAvatar>
                <div className="profile-info">
                  <h1 className="profile-name">{mockParent.firstName} {mockParent.lastName}</h1>
                  <p className="profile-role">Parent Account</p>
                </div>
              </div>
            </IonCardContent>
          </IonCard>

          {/* Contact Information */}
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Contact Information</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                <IonItem>
                  <IonIcon icon={mailOutline} slot="start" />
                  <IonLabel>
                    <p>Email</p>
                    <h3>{mockParent.email}</h3>
                  </IonLabel>
                </IonItem>
                <IonItem>
                  <IonIcon icon={callOutline} slot="start" />
                  <IonLabel>
                    <p>Phone</p>
                    <h3>{mockParent.phone}</h3>
                  </IonLabel>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>

          {/* Vehicle Information */}
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>
                <IonIcon icon={carOutline} /> Vehicle Information
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                <IonItem>
                  <IonLabel>
                    <p>Vehicle</p>
                    <h3>{mockParent.vehicleInfo.color} {mockParent.vehicleInfo.make} {mockParent.vehicleInfo.model}</h3>
                  </IonLabel>
                </IonItem>
                <IonItem>
                  <IonLabel>
                    <p>License Plate</p>
                    <h3>{mockParent.vehicleInfo.licensePlate}</h3>
                  </IonLabel>
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>

          {/* Children */}
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>My Children</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                {mockChildren.map(child => (
                  <IonItem key={child.id}>
                    <IonAvatar slot="start">
                      <img src={child.photoUrl || 'https://i.pravatar.cc/150'} alt={`${child.firstName} ${child.lastName}`} />
                    </IonAvatar>
                    <IonLabel>
                      <h2>{child.firstName} {child.lastName}</h2>
                      <p>{child.grade}</p>
                    </IonLabel>
                  </IonItem>
                ))}
              </IonList>
            </IonCardContent>
          </IonCard>

          {/* Notification Settings */}
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>
                <IonIcon icon={notificationsOutline} /> Notifications
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonList>
                <IonItem>
                  <IonLabel>
                    <h3>Push Notifications</h3>
                    <p>Receive app notifications</p>
                  </IonLabel>
                  <IonToggle 
                    checked={notifications} 
                    onIonChange={e => setNotifications(e.detail.checked)}
                  />
                </IonItem>
                <IonItem>
                  <IonLabel>
                    <h3>SMS Alerts</h3>
                    <p>Receive text message updates</p>
                  </IonLabel>
                  <IonToggle 
                    checked={smsAlerts} 
                    onIonChange={e => setSmsAlerts(e.detail.checked)}
                  />
                </IonItem>
              </IonList>
            </IonCardContent>
          </IonCard>

          {/* Actions */}
          <IonButton expand="block" color="danger" className="logout-button">
            <IonIcon slot="start" icon={logOutOutline} />
            Logout
          </IonButton>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Profile;
