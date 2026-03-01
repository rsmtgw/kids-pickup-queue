import React, { useState } from 'react';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonInput,
  IonModal,
  IonButtons,
  IonSpinner,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonIcon
} from '@ionic/react';
import { add, person, call, mail, school, flask } from 'ionicons/icons';
import { useKids, useDatabase } from '../services/databaseHooks';
import { Kid } from '../services/database';
import { seedMockKids } from '../services/seedData';
import './KidsManagement.css';

const KidsManagement: React.FC = () => {
  const { isReady, error: dbError } = useDatabase();
  const { kids, loading, addKid, updateKid, deleteKid, reload } = useKids();
  const [showModal, setShowModal] = useState(false);
  const [editingKid, setEditingKid] = useState<Kid | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    grade: '',
    parent_name: '',
    parent_phone: '',
    parent_email: '',
    pickup_code: ''
  });

  const generatePickupCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const openAddModal = () => {
    setEditingKid(null);
    setFormData({
      name: '',
      grade: '',
      parent_name: '',
      parent_phone: '',
      parent_email: '',
      pickup_code: generatePickupCode()
    });
    setShowModal(true);
  };

  const openEditModal = (kid: Kid) => {
    setEditingKid(kid);
    setFormData({
      name: kid.name,
      grade: kid.grade,
      parent_name: kid.parent_name,
      parent_phone: kid.parent_phone,
      parent_email: kid.parent_email || '',
      pickup_code: kid.pickup_code
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    try {
      if (editingKid) {
        await updateKid(editingKid.id!, formData);
      } else {
        await addKid(formData);
      }
      setShowModal(false);
    } catch (error) {
      console.error('Error saving kid:', error);
      alert('Error saving kid information');
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this kid?')) {
      try {
        await deleteKid(id);
      } catch (error) {
        console.error('Error deleting kid:', error);
        alert('Error deleting kid');
      }
    }
  };

  const handleSeedData = async () => {
    if (confirm('Add 50 mock kids to the database? This will create test data.')) {
      setIsSeeding(true);
      try {
        await seedMockKids(50);
        await reload();
        alert('Successfully added 50 mock kids!');
      } catch (error) {
        console.error('Error seeding data:', error);
        alert('Error adding mock data. Check console for details.');
      } finally {
        setIsSeeding(false);
      }
    }
  };

  if (!isReady) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Kids Management</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <IonSpinner />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  if (dbError) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonTitle>Kids Management</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <IonCard color="danger">
            <IonCardHeader>
              <IonCardTitle>Database Error</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>{dbError}</IonCardContent>
          </IonCard>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Kids Management</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={handleSeedData} disabled={isSeeding}>
              <IonIcon icon={flask} />
              {isSeeding ? 'Adding...' : 'Add 50 Mock'}
            </IonButton>
            <IonButton onClick={openAddModal}>
              <IonIcon icon={add} />
              Add Kid
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
            <IonSpinner />
          </div>
        ) : kids.length === 0 ? (
          <IonCard>
            <IonCardContent>
              <p>No kids registered yet. Click "Add Kid" to get started.</p>
            </IonCardContent>
          </IonCard>
        ) : (
          <IonList>
            {kids.map((kid) => (
              <IonCard key={kid.id}>
                <IonCardHeader>
                  <IonCardTitle>{kid.name}</IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <div className="kid-info">
                    <div className="info-row">
                      <IonIcon icon={school} />
                      <span>Grade: {kid.grade}</span>
                    </div>
                    <div className="info-row">
                      <IonIcon icon={person} />
                      <span>Parent: {kid.parent_name}</span>
                    </div>
                    <div className="info-row">
                      <IonIcon icon={call} />
                      <span>{kid.parent_phone}</span>
                    </div>
                    {kid.parent_email && (
                      <div className="info-row">
                        <IonIcon icon={mail} />
                        <span>{kid.parent_email}</span>
                      </div>
                    )}
                    <div className="info-row">
                      <strong>Pickup Code:</strong>
                      <span className="pickup-code">{kid.pickup_code}</span>
                    </div>
                  </div>
                  <div className="button-row">
                    <IonButton size="small" onClick={() => openEditModal(kid)}>
                      Edit
                    </IonButton>
                    <IonButton size="small" color="danger" onClick={() => handleDelete(kid.id!)}>
                      Delete
                    </IonButton>
                  </div>
                </IonCardContent>
              </IonCard>
            ))}
          </IonList>
        )}

        <IonModal isOpen={showModal} onDidDismiss={() => setShowModal(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{editingKid ? 'Edit Kid' : 'Add New Kid'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setShowModal(false)}>Close</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonList>
              <IonItem>
                <IonLabel position="stacked">Kid's Name *</IonLabel>
                <IonInput
                  value={formData.name}
                  onIonInput={(e) => setFormData({ ...formData, name: e.detail.value! })}
                  placeholder="Enter kid's name"
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Grade *</IonLabel>
                <IonInput
                  value={formData.grade}
                  onIonInput={(e) => setFormData({ ...formData, grade: e.detail.value! })}
                  placeholder="e.g., 3rd Grade"
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Parent's Name *</IonLabel>
                <IonInput
                  value={formData.parent_name}
                  onIonInput={(e) => setFormData({ ...formData, parent_name: e.detail.value! })}
                  placeholder="Enter parent's name"
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Parent's Phone *</IonLabel>
                <IonInput
                  value={formData.parent_phone}
                  onIonInput={(e) => setFormData({ ...formData, parent_phone: e.detail.value! })}
                  placeholder="(555) 123-4567"
                  type="tel"
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Parent's Email</IonLabel>
                <IonInput
                  value={formData.parent_email}
                  onIonInput={(e) => setFormData({ ...formData, parent_email: e.detail.value! })}
                  placeholder="parent@example.com"
                  type="email"
                />
              </IonItem>

              <IonItem>
                <IonLabel position="stacked">Pickup Code *</IonLabel>
                <IonInput
                  value={formData.pickup_code}
                  onIonInput={(e) => setFormData({ ...formData, pickup_code: e.detail.value! })}
                  placeholder="Unique code"
                />
                <IonButton slot="end" onClick={() => setFormData({ ...formData, pickup_code: generatePickupCode() })}>
                  Generate
                </IonButton>
              </IonItem>
            </IonList>

            <div className="ion-padding">
              <IonButton expand="block" onClick={handleSubmit}>
                {editingKid ? 'Update Kid' : 'Add Kid'}
              </IonButton>
            </div>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
};

export default KidsManagement;
