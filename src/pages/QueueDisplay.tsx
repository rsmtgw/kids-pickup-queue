import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonCard,
  IonCardContent,
  IonItem,
  IonLabel,
  IonAvatar,
  IonBadge,
  IonChip,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail
} from '@ionic/react';
import { personOutline, timeOutline, trophyOutline, arrowUpOutline } from 'ionicons/icons';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QueueEntry, Child, Parent } from '../types';
import './QueueDisplay.css';

const QueueDisplay: React.FC = () => {
  const [queueEntries, setQueueEntries] = useState<(QueueEntry & { child: Child, parent: Parent })[]>([]);
  const [myPosition, setMyPosition] = useState<number | null>(null);

  // Mock data - replace with real-time WebSocket connection
  const mockData = [
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
    },
    {
      id: 'q3',
      childId: 'c3',
      parentId: 'p3',
      position: 3,
      checkInTime: new Date(Date.now() - 180000),
      status: 'waiting' as const,
      child: {
        id: 'c3',
        firstName: 'Emma',
        lastName: 'Johnson',
        grade: '2nd Grade',
        parentIds: ['p3'],
        photoUrl: 'https://i.pravatar.cc/150?img=1'
      },
      parent: {
        id: 'p3',
        firstName: 'John',
        lastName: 'Johnson',
        phone: '555-0103',
        email: 'john@example.com',
        childIds: ['c3']
      }
    },
    {
      id: 'q4',
      childId: 'c4',
      parentId: 'p4',
      position: 4,
      checkInTime: new Date(Date.now() - 120000),
      status: 'waiting' as const,
      child: {
        id: 'c4',
        firstName: 'Oliver',
        lastName: 'Davis',
        grade: 'Kindergarten',
        parentIds: ['p4'],
        photoUrl: 'https://i.pravatar.cc/150?img=7'
      },
      parent: {
        id: 'p4',
        firstName: 'Lisa',
        lastName: 'Davis',
        phone: '555-0104',
        email: 'lisa@example.com',
        childIds: ['c4']
      }
    },
    {
      id: 'q5',
      childId: 'c5',
      parentId: 'p5',
      position: 5,
      checkInTime: new Date(Date.now() - 60000),
      status: 'waiting' as const,
      child: {
        id: 'c5',
        firstName: 'Ava',
        lastName: 'Martinez',
        grade: '4th Grade',
        parentIds: ['p5'],
        photoUrl: 'https://i.pravatar.cc/150?img=8'
      },
      parent: {
        id: 'p5',
        firstName: 'Carlos',
        lastName: 'Martinez',
        phone: '555-0105',
        email: 'carlos@example.com',
        childIds: ['c5']
      }
    }
  ];

  useEffect(() => {
    setQueueEntries(mockData);
    setMyPosition(3); // Mock user position
  }, []);

  const handleRefresh = (event: CustomEvent<RefresherEventDetail>) => {
    // Simulate API refresh
    setTimeout(() => {
      setQueueEntries([...mockData]);
      event.detail.complete();
    }, 1000);
  };

  const getWaitTime = (position: number) => {
    const avgTimePerChild = 2; // minutes
    return position * avgTimePerChild;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'success';
      case 'waiting': return 'primary';
      default: return 'medium';
    }
  };

  const getTimeSinceCheckIn = (checkInTime: Date) => {
    const diff = Date.now() - checkInTime.getTime();
    const minutes = Math.floor(diff / 60000);
    return `${minutes} min ago`;
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Queue</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen className="queue-content">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent></IonRefresherContent>
        </IonRefresher>

        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">Pickup Queue</IonTitle>
          </IonToolbar>
        </IonHeader>

        <div className="queue-container">
          {/* Queue Stats */}
          <IonCard className="stats-card">
            <IonCardContent>
              <div className="stats-grid">
                <div className="stat-item">
                  <IonIcon icon={personOutline} className="stat-icon" />
                  <div className="stat-value">{queueEntries.length}</div>
                  <div className="stat-label">In Queue</div>
                </div>
                <div className="stat-item">
                  <IonIcon icon={timeOutline} className="stat-icon" />
                  <div className="stat-value">~8</div>
                  <div className="stat-label">Avg Wait (min)</div>
                </div>
                {myPosition && (
                  <div className="stat-item highlight">
                    <IonIcon icon={trophyOutline} className="stat-icon" />
                    <div className="stat-value">{myPosition}</div>
                    <div className="stat-label">Your Position</div>
                  </div>
                )}
              </div>
            </IonCardContent>
          </IonCard>

          {/* Queue List */}
          <div className="queue-list">
            <AnimatePresence mode="popLayout">
              {queueEntries.map((entry, index) => {
                const isMyChild = entry.position === myPosition;
                const isNext = entry.position === 1;
                
                return (
                  <motion.div
                    key={entry.id}
                    layout
                    initial={{ opacity: 0, x: 100 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{
                      type: "spring",
                      stiffness: 500,
                      damping: 50,
                      delay: index * 0.05
                    }}
                  >
                    <IonCard 
                      className={`queue-card ${isMyChild ? 'my-child' : ''} ${isNext ? 'next-up' : ''} ${entry.status === 'ready' ? 'ready' : ''}`}
                    >
                      {isNext && (
                        <div className="next-badge notification-pulse">
                          <IonBadge color="success">NEXT UP!</IonBadge>
                        </div>
                      )}
                      {isMyChild && !isNext && (
                        <div className="my-badge">
                          <IonBadge color="primary">Your Child</IonBadge>
                        </div>
                      )}
                      
                      <IonItem lines="none" className="queue-item">
                        <div className="position-badge" slot="start">
                          <span className="position-number">{entry.position}</span>
                        </div>
                        
                        <IonAvatar slot="start">
                          <img 
                            src={entry.child.photoUrl || 'https://i.pravatar.cc/150'} 
                            alt={`${entry.child.firstName} ${entry.child.lastName}`}
                          />
                        </IonAvatar>
                        
                        <IonLabel>
                          <h2 className="child-name">
                            {entry.child.firstName} {entry.child.lastName}
                          </h2>
                          <p className="child-grade">{entry.child.grade}</p>
                          <div className="queue-meta">
                            <IonChip className="time-chip">
                              <IonIcon icon={timeOutline} />
                              <IonLabel>{getTimeSinceCheckIn(entry.checkInTime)}</IonLabel>
                            </IonChip>
                            {entry.parent.vehicleInfo && (
                              <IonChip className="vehicle-chip">
                                <IonLabel>
                                  {entry.parent.vehicleInfo.color} {entry.parent.vehicleInfo.make}
                                </IonLabel>
                              </IonChip>
                            )}
                          </div>
                        </IonLabel>
                        
                        <div className="queue-status" slot="end">
                          <IonBadge color={getStatusColor(entry.status)}>
                            {entry.status}
                          </IonBadge>
                          {entry.position > 1 && (
                            <div className="estimated-wait">
                              ~{getWaitTime(entry.position)} min
                            </div>
                          )}
                        </div>
                      </IonItem>
                      
                      {entry.status === 'ready' && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          className="ready-banner"
                        >
                          <IonIcon icon={arrowUpOutline} />
                          Ready for pickup at main entrance
                        </motion.div>
                      )}
                    </IonCard>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default QueueDisplay;
