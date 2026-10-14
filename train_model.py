import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import datasets, transforms, models
from torch.utils.data import DataLoader
import os
import shutil
import random
import json
from PIL import Image

# 1. Config and Hyperparameters
def find_dataset_dir(candidates):
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    return candidates[0]

SOURCE_TB = find_dataset_dir([
    r"Datasets\archive (3)\TB_Chest_Radiography_Database",
    r"C:\Users\Sande\Downloads\archive (3)\TB_Chest_Radiography_Database",
    r"..\..\archive (3)\TB_Chest_Radiography_Database",
    r"..\archive (3)\TB_Chest_Radiography_Database",
])

SOURCE_PNEUM = find_dataset_dir([
    r"Datasets\archive (2)\chest_xray",
    r"C:\Users\Sande\Downloads\archive (2)\chest_xray",
    r"..\..\archive (2)\chest_xray",
    r"..\archive (2)\chest_xray",
])

DATA_DIR    = "./dataset" 
BATCH_SIZE  = 16 # lowered to avoid OOM
EPOCHS      = int(os.environ.get("EPOCHS", 3))
LEARNING_RATE = 0.001
# Default 100 samples per class for optimal local CPU training speed (~3-5 mins total)
SAMPLE_LIMIT = int(os.environ.get("SAMPLE_LIMIT", 100))

def collect_images_from_nested(base_dir, target_leaf):
    """Recursively fetch images from a directory where the folder name matches target_leaf."""
    images_found = []
    if not os.path.exists(base_dir): return images_found
    for root, dirs, files in os.walk(base_dir):
        if os.path.basename(root).lower() == target_leaf.lower():
            for f in files:
                if f.lower().endswith(('.png', '.jpg', '.jpeg')):
                    file_path = os.path.join(root, f)
                    try:
                        # Verify the image is not corrupted before adding it
                        img = Image.open(file_path)
                        img.verify() # verify() is fast and doesn't load the whole image to memory
                        images_found.append(file_path)
                    except Exception:
                        pass
    return images_found

def prepare_data():
    print("Preparing multimodal train/val split from fused datasets...")
    if os.path.exists(DATA_DIR):
        print(f"Cleaning up old {DATA_DIR} directory...")
        shutil.rmtree(DATA_DIR)
        
    for split in ["train", "val"]:
        for cls in ["Normal", "Pneumonia", "Tuberculosis"]:
            os.makedirs(os.path.join(DATA_DIR, split, cls), exist_ok=True)
            
    # 1. Collect Images
    normal_tb_imgs = collect_images_from_nested(SOURCE_TB, "Normal")
    normal_pn_imgs = collect_images_from_nested(SOURCE_PNEUM, "NORMAL")
    all_normal = normal_tb_imgs + normal_pn_imgs
    
    tb_imgs    = collect_images_from_nested(SOURCE_TB, "Tuberculosis")
    pneum_imgs = collect_images_from_nested(SOURCE_PNEUM, "PNEUMONIA")

    datasets_map = {
        "Normal": all_normal,
        "Tuberculosis": tb_imgs,
        "Pneumonia": pneum_imgs
    }
    
    for cls, img_paths in datasets_map.items():
        if not img_paths:
            print(f"Warning: No images found for {cls}")
            continue
            
        random.seed(42)
        random.shuffle(img_paths)
        
        # Limit per class for balanced quick training (or full dataset if SAMPLE_LIMIT <= 0)
        if SAMPLE_LIMIT and SAMPLE_LIMIT > 0:
            img_paths = img_paths[:SAMPLE_LIMIT] 
        
        val_split = int(0.2 * len(img_paths))
        val_paths = img_paths[:val_split]
        train_paths = img_paths[val_split:]
        
        for i, path in enumerate(val_paths):
            ext = os.path.splitext(path)[1]
            shutil.copy(path, os.path.join(DATA_DIR, "val", cls, f"{cls}_val_{i}{ext}"))
        for i, path in enumerate(train_paths):
            ext = os.path.splitext(path)[1]
            shutil.copy(path, os.path.join(DATA_DIR, "train", cls, f"{cls}_train_{i}{ext}"))
            
    print("Dataset successfully merged and partitioned!")
    return True

# 2. Prepare Data Transformations
data_transforms = {
    'train': transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.RandomHorizontalFlip(),
        transforms.RandomRotation(10),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ]),
    'val': transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ]),
}

def train_model():
    if not prepare_data():
        return
        
    print("Initializing training...")
    
    try:
        image_datasets = {
            x: datasets.ImageFolder(os.path.join(DATA_DIR, x), data_transforms[x])
            for x in ['train', 'val']
        }
        # num_workers=0 to prevent multiprocessing lockups on windows during testing
        dataloaders = {
            x: DataLoader(image_datasets[x], batch_size=BATCH_SIZE, shuffle=True, num_workers=0)
            for x in ['train', 'val']
        }
        dataset_sizes = {x: len(image_datasets[x]) for x in ['train', 'val']}
        class_names = image_datasets['train'].classes
        print(f"Found classes: {class_names}")
    except FileNotFoundError:
        print("Dataset loading failed.")
        return

    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    # Save class names for pipeline
    with open('model_classes.json', 'w') as f:
        json.dump(class_names, f)

    # 4. Initialize the DenseNet Model
    model = models.densenet121(weights=models.DenseNet121_Weights.IMAGENET1K_V1)
    num_ftrs = model.classifier.in_features
    model.classifier = nn.Linear(num_ftrs, len(class_names))
    model = model.to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)

    # 5. Training Loop
    best_acc = 0.0
    
    for epoch in range(EPOCHS):
        print(f'\n--- Epoch {epoch+1}/{EPOCHS} ---', flush=True)

        for phase in ['train', 'val']:
            if phase == 'train':
                model.train()
            else:
                model.eval()

            running_loss = 0.0
            running_corrects = 0
            batch_count = 0

            for inputs, labels in dataloaders[phase]:
                inputs = inputs.to(device)
                labels = labels.to(device)

                optimizer.zero_grad()

                with torch.set_grad_enabled(phase == 'train'):
                    outputs = model(inputs)
                    _, preds = torch.max(outputs, 1)
                    loss = criterion(outputs, labels)

                    if phase == 'train':
                        loss.backward()
                        optimizer.step()

                running_loss += loss.item() * inputs.size(0)
                running_corrects += torch.sum(preds == labels.data)
                batch_count += 1
                if batch_count % 5 == 0:
                    print(f"[{phase}] Batch {batch_count}/{len(dataloaders[phase])} processed...", flush=True)

            epoch_loss = running_loss / dataset_sizes[phase]
            epoch_acc = running_corrects.double() / dataset_sizes[phase]

            print(f'==> {phase.capitalize()} Loss: {epoch_loss:.4f} | Accuracy: {epoch_acc:.4f}', flush=True)

            # Save the model
            if phase == 'val' and epoch_acc > best_acc:
                best_acc = epoch_acc
                torch.save(model.state_dict(), 'best_medical_model.pth')
                torch.save(model.state_dict(), 'model_1.pth')
                print(f"[Checkpointed] New best model saved with Val Acc: {best_acc:.4f}!", flush=True)

    print(f'\nTraining complete! Best Validation Accuracy: {best_acc:.4f}', flush=True)
    print("Models saved as 'best_medical_model.pth' and 'model_1.pth'. Ready for inference!", flush=True)

if __name__ == '__main__':
    train_model()
